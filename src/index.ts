import { app } from "@azure/functions";
import { chat } from "./functions/chat.js";

app.setup({
  enableHttpStream: true,
});

app.http('chat', {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "chat",
  handler: chat,
});
