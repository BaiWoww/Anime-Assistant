# 动漫季度打分 · Anime Assistant

基于 [yuc.wiki](https://yuc.wiki/) 与 [Bangumi](https://bgm.tv/) 的本地动漫季度打分工具：自动获取当前季度番剧列表，支持逐集打分、按星期分类浏览，以及按得分分档的「已评分」看板。

## 功能特性

- 自动获取当前季度番剧列表（按系统日期推算季度，支持上一季 / 下一季切换）
- **主分页 · 今日更新**：展示当天更新的番剧，按放送时刻排序
- **副分页 · 本季全部**：按星期几分类浏览全季番剧
- **已评分**：集中展示你评过分的番，按平均分归入 5 档（夯 / 顶级 / 人上人 / NPC / 拉完了），一屏看板展示
- 逐集打分（1–10 分，0.5 步进）+ 评语
- 封面图走服务端代理，绕过第三方 CDN 防盗链

## 技术栈

- 后端：零依赖 Node.js（`server.js`，内置 `http` / `fs` / `fetch`，无需 `npm install`）
- 前端：原生 HTML / CSS / JavaScript（无构建步骤）
- 数据源：yuc.wiki（主）+ Bangumi 开放日历 API（补充，不可达时自动降级）

## 快速开始

要求 Node.js ≥ 18。

```bash
git clone git@github.com:BaiWoww/Anime-Assistant.git
cd Anime-Assistant
node server.js
# 打开浏览器访问 http://localhost:3000
```

无需安装任何依赖。首次运行会缓存季度数据到 `data/`，评分保存在 `data/ratings.json`。

## 数据来源与署名

本项目的番剧列表、封面、话数主要来自 [yuc.wiki](https://yuc.wiki/)，评分与译名补充来自 [Bangumi](https://bgm.tv/)。

依据 **CC BY-NC-SA 4.0** 的署名原则：本站对原始数据进行了抓取与整理，用于**非商业用途**，版权归原作者所有。如数据来源方有更具体的许可要求，以其为准。

## 许可证

本项目以 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh) 许可证开源。

署名（Attribution）· 非商业性使用（NonCommercial）· 相同方式共享（ShareAlike）
