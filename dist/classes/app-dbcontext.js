import { DbContext, DbSet } from "dbcontext";
class AppDbContext extends DbContext {
    constructor(path) {
        super(path);
    }
    keys = new DbSet("keys");
    conversations = new DbSet("conversations");
}
export default AppDbContext;
//# sourceMappingURL=app-dbcontext.js.map