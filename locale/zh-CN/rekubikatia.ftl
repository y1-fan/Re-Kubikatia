kubikat-menu-import =
    .label = 从 Kubikat 导入…

kubikat-dialog-title = Re-Kubikatia
kubikat-dialog-heading = Re-Kubikatia
kubikat-dialog-intro =
    从 Kubikat 导入：粘贴检索结果页链接，或每行一个条目链接 / docid。本插件只使用
    SRU 接口、一次只发一个请求，并把条目直接写入 Zotero 中新建的文献组。

kubikat-notice =
    速率限制：一次一个请求 · 请求间隔 10 秒 · 单次最多 50 条。请勿短时间反复导入，
    也不要尝试绕过这些限制；请遵守 Kubikat 的 robots.txt 与使用条款。

kubikat-ack =
    我已了解上述速率限制，并只会将本工具用于个人、非商业用途。

kubikat-source-label = 链接
kubikat-source =
    .placeholder = https://www.kubikat.org/discovery/search?query=…

kubikat-collection-label = 文献组名称
kubikat-collection =
    .placeholder = 留空则自动生成

kubikat-max-label = 最多条数
kubikat-max-hint = 1–50 条/次

kubikat-library-label = 目标文库：
kubikat-options-label = 选项
kubikat-option-tags = 把主题词写入标签
kubikat-option-attachments = 把全文链接添加为 URL 附件

kubikat-start = 开始导入
kubikat-close = 关闭
kubikat-cancel-import = 取消导入
kubikat-open-collection = 查看文献组

kubikat-preview-empty = 粘贴 Kubikat 链接后即可开始。
kubikat-preview-search = 检索链接已就绪（SRU，仅支持基本检索词）。
kubikat-preview-items = 已识别 { $count } 个条目链接。

kubikat-starting = 正在启动…
kubikat-cancelling = 正在取消…
kubikat-done = 完成：已向“{ $name }”添加 { $count } 条文献。
kubikat-cancelled = 已取消，取消前已添加 { $count } 条文献。
kubikat-failed = 导入失败：{ $error }
