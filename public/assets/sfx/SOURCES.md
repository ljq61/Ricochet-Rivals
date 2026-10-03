# 空袭音效来源（2026-10-03）

## airstrike-engine.wav

- 来源：[Airplane Prop Loop — OpenGameArt](https://opengameart.org/content/airplane-prop-loop)。
- 原始录音：**jakobthiesen**，[Porter Prop plane Int.WAV](https://freesound.org/people/jakobthiesen/sounds/188423/)。
- 循环编辑：**AntumDeluge**；下载 `https://opengameart.org/sites/default/files/airplane_prop.flac`。
- 授权：[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)。感谢以上作者，署名保留在本文件及游戏 README。
- 项目修改：FLAC 转 44.1kHz / 16-bit 单声道 WAV，90Hz 高通、4kHz 低通及峰值限制；保留 4.957 秒循环。游戏音量 0.30；飞机出现至离场播放，取消/切场景即停止。

## airstrike-drop.wav

- 来源：**Diboz**，[daftBomb.ogg — Freesound](https://freesound.org/people/Diboz/sounds/215652/)。
- 授权：[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)。
- 下载公开预览 `https://cdn.freesound.org/previews/215/215652_3930831-lq.mp3`；原素材为带多普勒哨声及远处爆炸的卡通音效。
- 项目修改：截取 0.8–2.75 秒哨声，3倍时间压缩为约0.64秒，3.5kHz低通及淡入/淡出，转44.1kHz / 16-bit 单声道WAV；舍弃原音效中的爆炸，落地沿用已有爆炸声。游戏音量0.50。
- 投弹播放一次，落地/静音/取消/切场景即结束；取消后不会因恢复声音而重播。

下载源文件只用于转换，本仓库分发以上衍生 WAV 文件。署名和授权信息随素材保留。

下载源校验（SHA256）：

- airplane_prop.flac：`9e44850a2dfdd984bc9476c207ff0a37457cb50d28bec5d2d4d69539cf2aeafd`
- daftBomb 公开MP3预览：`4dc5743e572934615b02919614e7954d879d107afa04e26f33154474f4d7f963`
