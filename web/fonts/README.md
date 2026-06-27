# CBDB 罕用字字体（可选）

CBDB 人物姓名、地名等字段可能包含 **CJK 扩展区** 字符（Unicode Extension B/C 等）。仅使用系统默认字体或 Google Noto Serif TC 时，这些字可能显示为空白或方框。

## 推荐安装（与 CBDB 官方一致）

1. 打开 [CBDB Supporting Software](https://projects.iq.harvard.edu/cbdb/download-supporting-software)
2. 下载 **UniFonts.zip**
3. 解压后将 `.ttf` / `.otf` 文件复制到本目录 `web/fonts/`

常见文件名示例：`UniFont.ttf`、`uni00.ttf`（以压缩包内实际文件为准）。

4. 重启 CBDB Atlas 服务并刷新浏览器（Ctrl+Shift+R）

Atlas 会通过 `@font-face` 自动加载本目录下的字体；若未安装，仍回退到 Noto Serif TC/SC。

## 许可

UniFonts 版权归 CBDB / 哈佛大学项目所有，请遵循其发布页说明，**勿将字体文件提交到公开 git 仓库**（本目录已在 `.gitignore` 中忽略 `*.ttf` / `*.otf`）。
