const TAVILY_API_KEY = "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";
const GROQ_API_KEY = "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";
const chatBox = document.getElementById("chatBox");
const chatForm = document.getElementById("chatForm");
const userInput = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");

// 1. Array to hold full chat history for true context tracking
let chatHistory = [];

// Helper: Check if input is just a simple greeting
function isCasualGreeting(text) {
  const casualRegex = /^(hi|hello|hey|sup|whats? up|how are you|who are you|what is your name)\b/i;
  return casualRegex.test(text.trim());
}

// 2. Tavily Web Search
async function performSilentSearch(query) {
  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query: query,
        search_depth: "basic",
        max_results: 3
      })
    });
    const data = await response.json();
    if (!data || !data.results) return "";
    return data.results.map(r => `Source (${r.url}): ${r.content}`).join("\n\n");
  } catch (error) {
    console.error("Search Error:", error);
    return "";
  }
}

// 3. Groq Response Generator with Context Awareness
async function streamCPAIResponse(prompt, searchContext, outputElement) {
  const systemPrompt = `
    You are CP AI, an intelligent, perceptive, and adaptive assistant.

    CRITICAL RULES FOR CONTEXT CONTINUATION:
    - ALWAYS check past messages in the conversation to resolve short or ambiguous follow-ups.
    - Example: If the user previously asked for "matches today" and now follows up with "time", "schedules", or "where to watch", infer that they are asking for the match kickoff times, NOT a dictionary definition of time.
    - Do not treat short follow-up words in isolation unless the user explicitly asks for a standalone definition (e.g., "define time").
    - Keep track of subjects across turns to maintain smooth, intelligent conversation.

    GENERAL BEHAVIORS:
    - Simple Greetings: Respond briefly and casually to simple "hi", "how are you", etc.
    - Formatting: Use bold headings and lists for detailed answers, but keep short replies clean and concise.
    - Web Context: Integrate research context naturally. Never reveal you searched or used APIs.
  `;

  // Build message chain: System prompt + full chat history + current query
  const messages = [
    { role: "system", content: systemPrompt },
    ...chatHistory, // Includes previous user and assistant messages
    { role: "user", content: prompt }
  ];

  if (searchContext) {
    messages.push({
      role: "system",
      content: `Background Research Context:\n${searchContext}`
    });
  }

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        temperature: 0.6,
        stream: true,
        messages: messages
      })
    });

    if (!response.ok) {
      const errData = await response.json();
      outputElement.textContent = `Error: ${errData.error?.message || "Request failed"}`;
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let accumulatedText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n");

      for (const line of lines) {
        if (line.startsWith("data: ") && line !== "data: [DONE]") {
          try {
            const parsed = JSON.parse(line.slice(6));
            const content = parsed.choices?.[0]?.delta?.content || "";
            accumulatedText += content;

            // Stream response live using marked
            outputElement.innerHTML = marked.parse(accumulatedText);
            chatBox.scrollTop = chatBox.scrollHeight;
          } catch (e) {
            // Ignore partial chunk JSON parse errors
          }
        }
      }
    }

    // Save full conversation turn into memory history
    chatHistory.push({ role: "user", content: prompt });
    chatHistory.push({ role: "assistant", content: accumulatedText });

    // Optional: Keep history light (last 10 turns max)
    if (chatHistory.length > 20) {
      chatHistory = chatHistory.slice(-20);
    }

  } catch (error) {
    console.error("LLM Error:", error);
    outputElement.textContent = "I encountered an error processing your request.";
  }
}

// 4. Form Submission Handler
chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const query = userInput.value.trim();
  if (!query) return;

  appendMessage(query, "user-message");
  userInput.value = "";
  sendBtn.disabled = true;

  const loadingDiv = appendMessage("", "ai-message");

  let researchContext = "";
  
  // Perform search if it's not a standard greeting
  if (!isCasualGreeting(query)) {
    // Construct search query incorporating previous message if current query is very short
    let searchQuery = query;
    const lastUserMessage = chatHistory.filter(m => m.role === "user").pop();
    
    if (query.split(" ").length <= 2 && lastUserMessage) {
      searchQuery = `${lastUserMessage.content} ${query}`;
    }

    researchContext = await performSilentSearch(searchQuery);
  }

  await streamCPAIResponse(query, researchContext, loadingDiv);

  sendBtn.disabled = false;
  chatBox.scrollTop = chatBox.scrollHeight;
});

function appendMessage(text, className) {
  const msgDiv = document.createElement("div");
  msgDiv.className = `message ${className}`;
  msgDiv.textContent = text;
  chatBox.appendChild(msgDiv);
  chatBox.scrollTop = chatBox.scrollHeight;
  return msgDiv;
}