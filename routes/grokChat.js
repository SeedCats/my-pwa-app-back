const express = require('express');
const { createXai } = require('@ai-sdk/xai');
const { streamText, generateText } = require('ai');
const { authenticate } = require('../config/auth.js');
const { connectToDB, ObjectId } = require('../config/db.js');
require('dotenv').config();

const router = express.Router();

// Configuration constants
const DEFAULT_MODEL = 'grok-4-1-fast-non-reasoning';
const DEFAULT_OPTIONS = {
  temperature: 0.7,
  maxTokens: 3000,
  topP: 1.0
};

const xai = createXai({
  apiKey: process.env.GROK_API_KEY
});

// Helper functions
const parseMessages = (body) => {
  if (body.messages && Array.isArray(body.messages)) {
    return {
      messages: body.messages,
      currentMessage: body.messages[body.messages.length - 1]?.content || ''
    };
  }
  
  const { message, conversationHistory = [] } = body;
  if (!message || typeof message !== 'string') {
    throw new Error('Message is required and must be a string');
  }
  
  return {
    messages: [
      ...conversationHistory.map(msg => ({ role: msg.role, content: msg.content })),
      { role: 'user', content: message }
    ],
    currentMessage: message
  };
};

const appendFileContent = (messages, file) => {
  if (!file?.content) return;
  
  const fileContent = Buffer.from(file.content, 'base64').toString('utf-8');
  messages[messages.length - 1].content += `\n\nFile: ${file.name}\n${fileContent}`;
};

const buildAiOptions = (messages, options) => {
  const aiOptions = {
    model: xai.responses(process.env.GROK_MODEL || DEFAULT_MODEL),
    messages,
    system: options.systemPrompt || process.env.GROK_SYSTEM_PROMPT || 'You are a helpful AI assistant.',
    temperature: options.temperature || DEFAULT_OPTIONS.temperature,
    maxTokens: options.maxTokens || DEFAULT_OPTIONS.maxTokens,
    topP: options.topP || DEFAULT_OPTIONS.topP
  };

  // Enable search tools if sources requested
  if (options.maxSources > 0) {
    aiOptions.tools = {
      web_search: xai.tools.webSearch(),
      x_search: xai.tools.xSearch()
    };
  }

  return aiOptions;
};

const getErrorResponse = (error) => {
  if (error.message?.includes('API key')) {
    return { statusCode: 401, message: 'Invalid or missing API key' };
  }
  if (error.message?.includes('rate limit')) {
    return { statusCode: 429, message: 'Rate limit exceeded, please try again later' };
  }
  return { statusCode: 500, message: error.message || 'Failed to get AI response' };
};

router.post('/chat', authenticate, async (req, res) => {
  try {
    const { options = {}, file, chatId, title } = req.body;
    
    // Parse and validate messages
    const { messages, currentMessage } = parseMessages(req.body);
    console.log(`[Grok] ${req.user.email}: ${currentMessage.substring(0, 50)}...`);

    // Append file content if provided
    try {
      appendFileContent(messages, file);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid file content encoding'
      });
    }

    // Build AI configuration
    const aiOptions = buildAiOptions(messages, options);
    const wantsStream = (req.headers.accept || '').includes('text/event-stream');

    if (wantsStream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      try {
        const { fullStream } = streamText(aiOptions);
        const sources = [];
        let fullText = '';

        for await (const part of fullStream) {
          if (part.type === 'text-delta') {
            const text = part.textDelta || part.text || '';
            fullText += text;
            res.write(`data: ${JSON.stringify({ type: 'text-delta', text })}\n\n`);
          } else if (part.type === 'source' && part.sourceType === 'url') {
            sources.push({ url: part.url, title: part.url });
            res.write(`data: ${JSON.stringify({ type: 'source', url: part.url, title: part.url })}\n\n`);
          }
        }

        // Save conversation to database
        const assistantMessage = { role: 'assistant', content: fullText };
        const updatedMessages = [...messages, assistantMessage];
        
        const db = await connectToDB();
        if (chatId && ObjectId.isValid(chatId)) {
          // Update existing conversation
          await db.collection('grokchats').updateOne(
            { _id: new ObjectId(chatId), userId: new ObjectId(req.user._id) },
            { 
              $set: { 
                messages: updatedMessages,
                lastMessage: assistantMessage,
                updatedAt: new Date()
              }
            }
          );
        } else {
          // Create new conversation
          const newChat = {
            userId: new ObjectId(req.user._id),
            userEmail: req.user.email,
            title: title || currentMessage.substring(0, 50) + '...',
            messages: updatedMessages,
            lastMessage: assistantMessage,
            createdAt: new Date(),
            updatedAt: new Date()
          };
          const result = await db.collection('grokchats').insertOne(newChat);
          res.write(`data: ${JSON.stringify({ type: 'chatId', chatId: result.insertedId })}\n\n`);
        }

        res.write(`data: ${JSON.stringify({ type: 'done', message: fullText, sources })}\n\n`);
        console.log(`[Grok] Completed: ${fullText.length} chars, ${sources.length} sources`);
        res.end();

      } catch (error) {
        console.error('[Grok] Streaming error:', error);
        res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
        res.end();
      }

    } else {
      const result = await generateText(aiOptions);
      const sources = result.response?.sources
        ?.filter(src => src.sourceType === 'url')
        .map(src => ({ url: src.url, title: src.url })) || [];

      console.log(`[Grok] Response: ${result.text.length} chars, ${sources.length} sources`);

      // Save conversation to database
      const assistantMessage = { role: 'assistant', content: result.text };
      const updatedMessages = [...messages, assistantMessage];
      
      const db = await connectToDB();
      let savedChatId = chatId;
      
      if (chatId && ObjectId.isValid(chatId)) {
        // Update existing conversation
        await db.collection('grokchats').updateOne(
          { _id: new ObjectId(chatId), userId: new ObjectId(req.user._id) },
          { 
            $set: { 
              messages: updatedMessages,
              lastMessage: assistantMessage,
              updatedAt: new Date()
            }
          }
        );
      } else {
        // Create new conversation
        const newChat = {
          userId: new ObjectId(req.user._id),
          userEmail: req.user.email,
          title: title || currentMessage.substring(0, 50) + '...',
          messages: updatedMessages,
          lastMessage: assistantMessage,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        const insertResult = await db.collection('grokchats').insertOne(newChat);
        savedChatId = insertResult.insertedId;
      }

      res.json({
        success: true,
        data: {
          message: result.text,
          sources: sources,
          chatId: savedChatId
        }
      });
    }

  } catch (error) {
    console.error('[Grok] Error:', req.user?.email, error.message);
    const { statusCode, message } = getErrorResponse(error);
    res.status(statusCode).json({ success: false, message });
  }
});

// GET /api/grok/chat - List all Grok chat conversations
router.get('/chat', authenticate, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const db = await connectToDB();

    const query = { userId: new ObjectId(req.user._id) };
    const total = await db.collection('grokchats').countDocuments(query);
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const chats = await db.collection('grokchats')
      .find(query, { projection: { messages: 0 } })
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .toArray();

    res.status(200).json({
      success: true,
      data: {
        chats,
        pagination: {
          currentPage: parseInt(page),
          perPage: parseInt(limit),
          total
        }
      }
    });
  } catch (error) {
    console.error('[Grok] List error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/grok/chat/:id - Get single Grok chat with full message history
router.get('/chat/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid chat id' });
    }

    const db = await connectToDB();
    const chat = await db.collection('grokchats').findOne({
      _id: new ObjectId(id),
      userId: new ObjectId(req.user._id)
    });

    if (!chat) {
      return res.status(404).json({ success: false, message: 'Chat not found' });
    }

    res.status(200).json({ success: true, data: chat });
  } catch (error) {
    console.error('[Grok] Fetch error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /api/grok/chat/:id - Delete single Grok chat
router.delete('/chat/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid chat id' });
    }

    const db = await connectToDB();
    const result = await db.collection('grokchats').deleteOne({
      _id: new ObjectId(id),
      userId: new ObjectId(req.user._id)
    });

    if (result.deletedCount === 1) {
      return res.status(200).json({ success: true, message: 'Chat deleted' });
    }

    res.status(404).json({ success: false, message: 'Chat not found' });
  } catch (error) {
    console.error('[Grok] Delete error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /api/grok/chat - Delete all Grok chats for user
router.delete('/chat', authenticate, async (req, res) => {
  try {
    const db = await connectToDB();
    const result = await db.collection('grokchats').deleteMany({ 
      userId: new ObjectId(req.user._id) 
    });
    
    res.status(200).json({ 
      success: true, 
      data: { deletedCount: result.deletedCount } 
    });
  } catch (error) {
    console.error('[Grok] Delete all error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
