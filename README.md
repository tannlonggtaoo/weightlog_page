# Weightlog

个人体重与饮食手记。原生 HTML、CSS 和 JavaScript，通过 GitHub API 读写 `tannlonggtaoo/weightlog`。

## 使用

第一次打开时输入对数据仓库有 Contents 读写权限的 GitHub PAT。此浏览器会记住令牌，可在“连接设置”中更换或清除。

在“记一笔”里输入公斤数或饮食描述并保存。时间默认取保存时刻，点“修改时间”可以补记。在“总览”里查看趋势、修改或删除任意一条记录。

## 发布与本地预览

在前端仓库的 Settings → Pages 选择 Deploy from a branch，发布源选 `main` 和 `/(root)`。推送至该分支后由 GitHub Pages 自动发布。

本地预览时，在此目录运行 `python preview.py`，用浏览器打开 `http://127.0.0.1:8000`。
