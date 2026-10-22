# 取经小英雄

给小朋友复习学而思（人文 / 思维）的西游记闯关答题游戏。iPad 上打开就能玩，第一次打开后断网也能玩。

- 孩子端：`https://pp99bb.github.io/qujing/` —— 在 iPad Safari 里“分享 → 添加到主屏幕”，以后从桌面图标打开。孩子端没有任何家长入口。
- 家长端：`https://pp99bb.github.io/qujing/parent.html` —— 单独的网址，在电脑上打开。加题、改题、设置、学习报告都在这里。
- 云同步：家长端和孩子端通过私有仓库 `pp99bb/qujing-data` 同步（家长加的题和设置 → iPad；孩子的进度 → 家长端的学习报告）。

文件：`index.html` 孩子端，`parent.html` 家长端，`game.js` / `style.css` 游戏本体，`bank.json` 内置题库，`sw.js` 离线缓存。
