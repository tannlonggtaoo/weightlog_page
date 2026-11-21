# Weightlog

个人体重、饮食与运动手记。原生 HTML、CSS 和 JavaScript，通过 GitHub API 读写 `tannlonggtaoo/weightlog`。

## 使用

第一次打开时输入对数据仓库有 Contents 读写权限的 GitHub PAT。在右上角“设置”中可以管理 PAT、OpenRouter API Key，以及选填的出生年份和身高。这些设置保存在当前浏览器。

在“记一笔”里选择“体重”输入公斤数，选择“饮食”写下吃了什么，或选择“运动”用文字描述运动内容。每条饮食记录可以拍照或选一张照片，文字和照片至少填一项。浏览器会先将照片压缩为最长边 960 像素以内、最多 150 KB 的 JPEG，点“保存记录”时上传到 GitHub。

饮食和运动都可以选填热量（kcal）。配置 OpenRouter Key 后，点“估算”会将当前描述和照片发送给 OpenRouter，由模型返回热量并填入表单。你可以改填或直接保存。数字随记录保存为 `kcal`，留空时省略该字段。总览中的“修改”也可手填或估算。

时间默认取保存时刻，点“修改时间”可以补记。“总览”按需加载照片，轻点小图可放大。修改记录时可以换图或移除照片，删除记录时会一并从仓库当前版本移除对应照片。

## 发布与本地预览

在前端仓库的 Settings → Pages 选择 Deploy from a branch，发布源选 `main` 和 `/(root)`。推送至该分支后由 GitHub Pages 自动发布。

本地预览时，在此目录运行 `python preview.py`，用浏览器打开 `http://127.0.0.1:8000`。
