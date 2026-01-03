const express = require('express');
const { createXai } = require('@ai-sdk/xai');
const { streamText, generateText } = require('ai');
const { authenticate } = require('../config/auth.js');
require('dotenv').config();

const router = express.Router();

const xai = createXai({
  apiKey: process.env.GROK_API_KEY
});

router.post('/chat', authenticate, async (req, res) => {
  try {
    const { options = {}, file } = req.body;
    let messages, currentMessage;
    
    // Handle both message formats
    if (req.body.messages && Array.isArray(req.body.messages)) {
      messages = req.body.messages;
      currentMessage = messages[messages.length - 1]?.content || '';
    } else {
      const { message, conversationHistory = [] } = req.body;
      
      if (!message || typeof message !== 'string') {
        return res.status(400).json({
          success: false,
          message: 'Message is required and must be a string'
        });
      }
      
      currentMessage = message;
      messages = [
        ...conversationHistory.map(msg => ({ role: msg.role, content: msg.content })),
        { role: 'user', content: message }
      ];
    }

    console.log(`[Grok] ${req.user.email}: ${currentMessage.substring(0, 50)}...`);

    // Append file content if provided
    if (file?.content) {
      try {
        const fileContent = Buffer.from(file.content, 'base64').toString('utf-8');
        messages[messages.length - 1].content += `\n\nFile: ${file.name}\n${fileContent}`;
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: 'Invalid file content encoding'
        });
      }
    }

    // Configure AI options with Responses API
    const aiOptions = {
      model: xai.responses(process.env.GROK_MODEL || 'grok-4-fast'),
      messages: messages,
      temperature: options.temperature || 1.0,
      maxTokens: options.maxTokens || 3000,
      topP: options.topP || 1.0
    };

    // Enable search tools if sources requested
    if (options.maxSources > 0) {
      aiOptions.tools = {
        web_search: xai.tools.webSearch(),
        x_search: xai.tools.xSearch()
      };
    }

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

      res.json({
        success: true,
        data: {
          message: result.text,
          sources: sources
        }
      });
    }

  } catch (error) {
    console.error('[Grok] Error:', req.user?.email, error.message);
    
    const statusCode = error.message?.includes('API key') ? 401
      : error.message?.includes('rate limit') ? 429
      : 500;
    
    const message = error.message?.includes('API key') ? 'Invalid or missing API key'
      : error.message?.includes('rate limit') ? 'Rate limit exceeded, please try again later'
      : error.message || 'Failed to get AI response';

    res.status(statusCode).json({ success: false, message });
  }
});

module.exports = router;
