const express = require('express');
const { createXai } = require('@ai-sdk/xai');
const { streamText, generateText } = require('ai');
const { authenticate } = require('../config/auth.js');
const { connectToDB, ObjectId } = require('../config/db.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const router = express.Router();

// Read RAG Knowledge Base
const kbPath = path.join(__dirname, '../knowledge_base.md');
let knowledgeBaseContent = '';
try {
  knowledgeBaseContent = fs.readFileSync(kbPath, 'utf8');
} catch (err) {
  console.error('[Grok] Failed to read knowledge_base.md:', err.message);
}

// Configuration constants
const DEFAULT_MODEL = process.env.GROK_DEFAULT_MODEL;
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

const system_prompt = `
You are an AI Health Information Assistant. Your persona is that of a knowledgeable, empathetic, and responsible healthcare information provider. Your primary goal is to provide clear, professional, and safe information about Body Mass Index (BMI), heart rate, and stress levels.

--- REFERENCE KNOWLEDGE BASE START ---
You MUST use the following information to answer the user's questions accurately. 
Do not hallucinate thresholds or guidelines; rely on the data provided below or search online if needed:
\${knowledgeBaseContent}
--- REFERENCE KNOWLEDGE BASE END ---

If you use any information from the REFERENCE KNOWLEDGE BASE, you MUST explicitly cite it in your response by adding "(Source: Knowledge Base)" next to the data.

 CORE DIRECTIVES 

0. Only answer to the user's question about **Health**. Do not provide information on other topics.

1.  SAFETY FIRST - THE DISCLAIMER IS MANDATORY:**
       Your **last** response in any conversation MUST include this exact disclaimer: "IMPORTANT: I am an AI assistant and not a medical professional. The information I provide is for references only and is not a substitute for professional medical advice, diagnosis, or treatment. Always seek the advice of your qualified doctors with any questions you may have."

2.  PERSONA AND TONE:
       Professional & Evidence-Based: Base your information on widely accepted health standards (e.g., WHO, AHA). Use clear, easy-to-understand language.

3.  RESPONSE STRUCTURE:
       For each metric (BMI, Heart Rate, Stress), follow this template:
        1.  Direct Analysis: Begin immediately by defining the metric and interpreting the user's data.
        2.  Definition: Briefly explain the metric.
        3.  Interpretation: Explain the user's number within standard categories.
        4.  Health Context: Discuss general health implications.
        5.  General Lifestyle Factors: Provide general, non-prescriptive advice (e.g., diet, exercise, sleep).

 TOPIC-SPECIFIC GUIDELINES 
    
A. Others:
       You should use online search for information.
       Make sure your responses are concise and clear assuming the user does not want to read long responses. If the user wants more details, they can ask follow-up questions.
    
B. Output Format:
       Responses must be well-structured and easy to read with step-by-step explanations.
       For each bullet points, add line breaks to make it easier to read. Avoid large blocks of text.
`;

const buildAiOptions = (messages, options) => {
  const aiOptions = {
    model: xai.responses(process.env.GROK_MODEL || DEFAULT_MODEL),
    messages,
    system: system_prompt,
    temperature: options.temperature || DEFAULT_OPTIONS.temperature,
    maxTokens: options.maxTokens || DEFAULT_OPTIONS.maxTokens,
    topP: options.topP || DEFAULT_OPTIONS.topP
  };

  // Always enable search tools so Grok can search online
  aiOptions.tools = {
    web_search: xai.tools.webSearch()
  };

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
        const streamResult = streamText(aiOptions);
        const { fullStream } = streamResult;
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

        let usage = null;
        try {
          usage = await streamResult.usage;
          if (usage) {
            res.write(`data: ${JSON.stringify({ type: 'usage', usage })}\n\n`);
          }
        } catch(e) {
          console.error('[Grok] Usage error:', e.message);
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
        console.log(`[Grok] Completed: ${fullText.length} chars, ${sources.length} sources, Usage:`, usage);
        res.end();

      } catch (error) {
        console.error('[Grok] Streaming error:', error);
        res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
        res.end();
      }

    } else {
      const result = await generateText(aiOptions);
      const usage = result.usage || null;
      const sources = result.response?.sources
        ?.filter(src => src.sourceType === 'url')
        .map(src => ({ url: src.url, title: src.url })) || [];

      console.log(`[Grok] Response: ${result.text.length} chars, ${sources.length} sources, Usage:`, usage);

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
          chatId: savedChatId,
          usage: usage
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
