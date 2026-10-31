<div align="center">

# 图匠 PixSmith

**浏览器里的 AI 图片工具箱：抠图、证件照、AI 消除、变清晰。**

所有 AI 模型都在你的浏览器里运行（WebGPU / WebAssembly），照片不上传任何服务器。
免费 · 开源 · 不用注册 · 可离线

[在线使用](https://woodti.github.io/pixsmith/) · [下载客户端](https://github.com/woodti/pixsmith/releases/latest) · [English](#english)

</div>

## 这个项目是什么

一个“浏览器端 AI 能做到什么”的展示，同时每个功能都能直接拿来用。没有后端：页面是静态文件，模型首次使用时下载到浏览器缓存，之后可以离线使用。推理在 Web Worker 里跑，有 WebGPU 时用显卡，没有时退回 WebAssembly（CPU）。

## 功能

### 抠图

- 自动判断人像还是物品：人像用 MODNet（发丝级），物品、动物用 IS-Net；支持 WebGPU 的浏览器可以用 BiRefNet 高清模式
- 边缘颜色修正：换背景后头发边不会带着原背景的颜色
- 背景：透明、纯色、渐变、自定义图片、原图虚化（人像模式效果）
- 贴纸白边（任意颜色描边）、投影、地面阴影
- 裁到主体、正方形（白底 + 正方形 + 地面阴影 = 电商主图）
- 擦除 / 恢复画笔，支持缩放、拖动、双指捏合，可撤销
- 一次最多 10 张，打包 ZIP 下载

### 证件照

- 自动识别人脸，按规格把头顶、下巴放到标准位置，自动扶正
- 一寸、二寸、小一寸、大一寸、身份证、驾驶证、护照、美国 / 日本 / 申根签证、教师资格证、四六级、公务员考试、简历照，或自定义尺寸
- 换底色、美颜（磨皮、美白、亮度、对比度、饱和度）
- 换正装：藏青 / 黑 / 灰西装、女士西装、白衬衫，自动对齐肩线（服装为代码绘制，无版权素材）
- 合规自检：正脸、俯仰、头部比例、居中、清晰度、曝光、光线是否均匀
- 摄像头直接拍照（带取景框）
- 按 KB 限制自动压缩
- 6 寸 / 5 寸相纸排版，可两种规格混排（如 8 张一寸 + 2 张二寸），300dpi，带裁切线

### AI 消除

- 涂抹路人、杂物、水印、文字，松手自动补全背景；可多次涂抹、撤销、对比原图
- 原尺寸输出

### 变清晰

- 放大 2 / 4 倍，同时去模糊、去噪、去压缩痕迹
- 分块推理，带进度和剩余时间；拖动分隔线对比效果

### 能力展示页

首页显示当前设备是否支持 WebGPU / shader-f16、每个模型的大小、许可、缓存状态以及运行在 GPU 还是 CPU，可一键清除模型缓存。

## 模型

| 用途 | 模型 | 许可 | 大小 | 运行 |
| --- | --- | --- | --- | --- |
| 人像抠图 | [MODNet](https://github.com/ZHKKKe/MODNet)（[ONNX](https://huggingface.co/Xenova/modnet)） | Apache-2.0 | 26MB | CPU |
| 通用抠图 | [IS-Net general use](https://github.com/xuebinqin/DIS)，经 `scripts/convert_isnet.py` 转为 fp16 | Apache-2.0 | 91MB | GPU / CPU |
| 高清抠图 | [BiRefNet lite](https://github.com/ZhengPeng7/BiRefNet)（[ONNX](https://huggingface.co/onnx-community/BiRefNet_lite-ONNX)） | MIT | 115MB | 仅 GPU（需 shader-f16） |
| 人脸检测 | [YuNet](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet) | MIT | 0.2MB | CPU |
| AI 消除 | [MI-GAN](https://github.com/Picsart-AI-Research/MI-GAN)（[ONNX](https://huggingface.co/andraniksargsyan/migan)） | MIT | 28MB | GPU / CPU |
| 超分辨率 | [Real-ESRGAN general v3](https://github.com/xinntao/Real-ESRGAN)（[ONNX](https://huggingface.co/vlad-grig/realesr-general-x4v3-onnx)） | BSD-3-Clause | 5MB | GPU / CPU |

推理引擎是 [ONNX Runtime Web](https://onnxruntime.ai/)。边缘颜色修正用的是 Forte & Pitié 的 [Approximate Fast Foreground Colour Estimation](https://arxiv.org/abs/2006.14970)。

## 桌面客户端

Windows / macOS / Linux 安装包在 [Releases](https://github.com/woodti/pixsmith/releases/latest)。客户端用 [Tauri](https://tauri.app/) 打包，内置全部模型，装好后断网也能用：

- 不用等模型下载，打开就能用
- CPU 计算可以多线程（网页版受浏览器限制只能用 1 个线程）
- 导出时弹出系统“另存为”窗口

macOS 版经过 Apple 签名和公证；Windows 版暂未签名，出现“已保护你的电脑”时点“更多信息 → 仍要运行”。

自己打包需要 [Rust](https://rustup.rs/) 和对应系统的 [Tauri 依赖](https://tauri.app/start/prerequisites/)：

```bash
npm install
npm run desktop     # 产物在 src-tauri/target/release/bundle/
```

推送 `v*` 标签会由 GitHub Actions 构建四个平台的安装包并发布 Release。

## 本地运行

需要 Node.js 20 或更高版本。

```bash
npm install
npm run dev
```

首次运行会把模型下载到 `public/models/`（约 290MB，已在 `.gitignore` 中）。大于 100MB 的模型会被切成两段，方便放在 GitHub Pages 等静态托管上，浏览器加载时再拼回去。

## 目录

```
src/
  ai/          模型清单、Web Worker 推理（matte / faces / inpaint / upscale）和调用封装
  lib/         图像工具、前景色估计、抠图特效合成、缩放拖动画布
  home/        能力展示首页
  cutout/      抠图
  idphoto/     证件照（规格、美颜、自检、正装、排版、拍照）
  erase/       AI 消除
  upscale/     变清晰
src-tauri/     桌面客户端（Tauri 2）
scripts/       模型下载、IS-Net fp16 转换
```

## 已知限制

- 没有 WebGPU 时用单线程 CPU 推理：通用抠图约 20 秒一张，变清晰会先把大图缩小
- Safari 以及 macOS / Linux 客户端（WebKit 内核）只用 CPU 计算：onnxruntime 的 WebGPU 版本在 WebKit 里推理会卡住，所以这些环境固定用纯 WebAssembly 版本
- 证件照的规格数据是常见要求，正式使用请以官方要求为准
- 换正装是代码绘制的通用款式，头部明显歪斜或长发披肩时需要手动微调
- 高清抠图（BiRefNet）需要支持 shader-f16 的 WebGPU，目前只验证了模型文件和前后处理，尚未在真实显卡上实测，属于实验功能

## License

MIT。模型按各自许可使用（见上表）。

---

## English

**PixSmith** is an in-browser AI image toolbox — background removal, ID photos, object removal and upscaling. Every model runs locally via ONNX Runtime Web (WebGPU when available, WebAssembly otherwise); nothing is uploaded.

- **Background removal** — MODNet for people, IS-Net for objects, BiRefNet on WebGPU; edge colour decontamination; transparent / colour / gradient / image / blurred backgrounds; sticker outlines, drop and ground shadows; crop to subject or square; erase / restore brush with zoom and pinch; batch ZIP.
- **ID photos** — face-aware framing for common Chinese and visa sizes, background colours, retouching, procedurally drawn business outfits, requirement checks, camera capture, file-size cap, 4×6 / 3.5×5 print sheets (mixed sizes) at 300 dpi.
- **Object removal** — paint over people, clutter or watermarks; MI-GAN fills the hole.
- **Upscaling** — Real-ESRGAN ×2 / ×4 with tiled inference and a before/after slider.
- **Desktop app** — Tauri 2 build for Windows / macOS / Linux with every model bundled (fully offline, multi-threaded CPU inference). Grab it from [Releases](https://github.com/woodti/pixsmith/releases/latest) or run `npm run desktop`.

```bash
npm install
npm run dev
```

MIT licensed. Models: MODNet (Apache-2.0), IS-Net (Apache-2.0), BiRefNet (MIT), YuNet (MIT), MI-GAN (MIT), Real-ESRGAN (BSD-3-Clause).
