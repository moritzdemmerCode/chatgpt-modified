import { DbContext, DbSet } from "dbcontext";
import Conversation from "../models/conversation.js";
import OpenAIKey from "../models/openai-key.js";
declare class AppDbContext extends DbContext {
    constructor(path?: string);
    keys: DbSet<OpenAIKey>;
    conversations: DbSet<Conversation>;
}
export default AppDbContext;
