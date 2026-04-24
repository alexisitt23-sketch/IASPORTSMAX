exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const body = JSON.parse(event.body);

    // Image analysis - simple, no streaming, no tools
    if (body.content) {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 1500,
          messages: [{ role: "user", content: body.content }],
        }),
      });
      const data = await response.json();
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify(data),
      };
    }

    // Quiniela analysis with web search - handle full tool_use cycle
    const messages = body.messages || [];
    let fullText = '';
    let currentMessages = [...messages];

    // Agentic loop: keep going until no more tool calls
    for (let turn = 0; turn < 8; turn++) {
      const requestBody = {
        model: "claude-sonnet-4-5",
        max_tokens: 4000,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: currentMessages,
      };

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(requestBody),
      });

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error.message);
      }

      // Collect all text from this turn
      const textBlocks = (data.content || []).filter(b => b.type === 'text');
      fullText += textBlocks.map(b => b.text).join('');

      // If no tool use, we're done
      const toolUseBlocks = (data.content || []).filter(b => b.type === 'tool_use');
      if (toolUseBlocks.length === 0 || data.stop_reason === 'end_turn') {
        break;
      }

      // Add assistant turn + tool results to continue
      currentMessages.push({ role: 'assistant', content: data.content });
      const toolResults = toolUseBlocks.map(tool => ({
        type: 'tool_result',
        tool_use_id: tool.id,
        content: tool.input?.query ? `Búsqueda realizada: ${tool.input.query}` : 'OK',
      }));
      currentMessages.push({ role: 'user', content: toolResults });
    }

    // Return as SSE stream format so frontend streaming parser works
    const sseData = `data: ${JSON.stringify({
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: fullText }
    })}\n\ndata: [DONE]\n\n`;

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-cache",
      },
      body: sseData,
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: { message: err.message } }),
    };
  }
};
