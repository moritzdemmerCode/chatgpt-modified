import Usage from "../models/chatgpt-usage.js";
import Options from "../models/chatgpt-options.js";
import Conversation from "../models/conversation.js";
declare class ChatGPT {
    options: Options;
    private db;
    onUsage: (usage: Usage) => void;
    constructor(key: string | string[], options?: Options);
    private getOpenAIKey;
    private chunksToLines;
    private linesToMessages;
    private streamCompletion;
    private getInstructions;
    addConversation(conversationId: string, userName?: string): Conversation;
    getConversation(conversationId: string, userName?: string): Conversation;
    resetConversation(conversationId: string): Conversation;
    ask(prompt: string, conversationId?: string, contactName?: string, userName?: string): Promise<string>;
    askStream(data: (arg0: string) => void, usage: (usage: Usage) => void, prompt: string, conversationId?: string, contactName?: string, userName?: string): Promise<string>;
    getCurrentDateTime(): string;
    moderate(prompt: string, key: string): Promise<boolean>;
    private generatePrompt;
    private generateMessages;
    private generateMessagesForAPI;
    private countTokens;
    private getToday;
    private getTime;
    private wait;
}
export default ChatGPT;
