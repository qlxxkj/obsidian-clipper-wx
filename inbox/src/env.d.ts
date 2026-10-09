// Worker 构建/运行期类型(env + 依赖)。
interface Env {
    INBOX: KVNamespace;
    ADMIN?: string;
}
