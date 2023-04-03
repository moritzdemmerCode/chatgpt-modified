import Options from "../models/options.js";
import Usage from "../models/chatgpt-usage.js";
import Conversation from "../models/conversation.js";
declare class OpenAI {
    private db;
    options: Options;
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
    ask(prompt: string, conversationId?: string, userName?: string): Promise<string>;
    askStream(data: (arg0: string) => void, usage: (usage: Usage) => void, prompt: string, conversationId?: string, userName?: string): Promise<string>;
    private generatePrompt;
    moderate(prompt: string, key: string): Promise<boolean>;
    private convToString;
    private getToday;
    private getTime;
    private wait;
}
export default OpenAI;
