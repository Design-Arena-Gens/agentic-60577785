"use client";

import { useState, useRef, useEffect } from "react";

export default function Home() {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [scaleFactor, setScaleFactor] = useState(2);
  const [originalDimensions, setOriginalDimensions] = useState({ width: 0, height: 0 });

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const outputVideoRef = useRef<HTMLVideoElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith("video/")) {
      setVideoFile(file);
      setOutputUrl(null);
      setProgress(0);

      const video = document.createElement("video");
      video.src = URL.createObjectURL(file);
      video.onloadedmetadata = () => {
        setOriginalDimensions({ width: video.videoWidth, height: video.videoHeight });
      };
    }
  };

  const bilinearInterpolation = (
    srcData: Uint8ClampedArray,
    srcWidth: number,
    srcHeight: number,
    dstWidth: number,
    dstHeight: number
  ): Uint8ClampedArray => {
    const dstData = new Uint8ClampedArray(dstWidth * dstHeight * 4);
    const xRatio = srcWidth / dstWidth;
    const yRatio = srcHeight / dstHeight;

    for (let i = 0; i < dstHeight; i++) {
      for (let j = 0; j < dstWidth; j++) {
        const x = j * xRatio;
        const y = i * yRatio;
        const x1 = Math.floor(x);
        const y1 = Math.floor(y);
        const x2 = Math.min(x1 + 1, srcWidth - 1);
        const y2 = Math.min(y1 + 1, srcHeight - 1);

        const dx = x - x1;
        const dy = y - y1;

        for (let c = 0; c < 4; c++) {
          const p1 = srcData[(y1 * srcWidth + x1) * 4 + c];
          const p2 = srcData[(y1 * srcWidth + x2) * 4 + c];
          const p3 = srcData[(y2 * srcWidth + x1) * 4 + c];
          const p4 = srcData[(y2 * srcWidth + x2) * 4 + c];

          const val =
            p1 * (1 - dx) * (1 - dy) +
            p2 * dx * (1 - dy) +
            p3 * (1 - dx) * dy +
            p4 * dx * dy;

          dstData[(i * dstWidth + j) * 4 + c] = Math.round(val);
        }
      }
    }

    return dstData;
  };

  const sharpenFrame = (
    imageData: Uint8ClampedArray,
    width: number,
    height: number
  ): Uint8ClampedArray => {
    const output = new Uint8ClampedArray(imageData.length);
    const kernel = [
      [0, -1, 0],
      [-1, 5, -1],
      [0, -1, 0],
    ];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        for (let c = 0; c < 3; c++) {
          let sum = 0;
          for (let ky = -1; ky <= 1; ky++) {
            for (let kx = -1; kx <= 1; kx++) {
              const px = Math.max(0, Math.min(width - 1, x + kx));
              const py = Math.max(0, Math.min(height - 1, y + ky));
              sum += imageData[(py * width + px) * 4 + c] * kernel[ky + 1][kx + 1];
            }
          }
          output[(y * width + x) * 4 + c] = Math.max(0, Math.min(255, sum));
        }
        output[(y * width + x) * 4 + 3] = imageData[(y * width + x) * 4 + 3];
      }
    }

    return output;
  };

  const upscaleVideo = async () => {
    if (!videoFile || !videoRef.current || !canvasRef.current) return;

    setIsProcessing(true);
    setProgress(0);

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    if (!ctx) return;

    video.src = URL.createObjectURL(videoFile);

    await new Promise((resolve) => {
      video.onloadedmetadata = resolve;
    });

    const srcWidth = video.videoWidth;
    const srcHeight = video.videoHeight;
    const dstWidth = srcWidth * scaleFactor;
    const dstHeight = srcHeight * scaleFactor;

    canvas.width = srcWidth;
    canvas.height = srcHeight;

    const outputCanvas = document.createElement("canvas");
    outputCanvas.width = dstWidth;
    outputCanvas.height = dstHeight;
    const outputCtx = outputCanvas.getContext("2d");

    if (!outputCtx) return;

    const stream = outputCanvas.captureStream(30);
    const mediaRecorder = new MediaRecorder(stream, {
      mimeType: "video/webm;codecs=vp9",
    });

    const chunks: Blob[] = [];
    mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: "video/webm" });
      setOutputUrl(URL.createObjectURL(blob));
      setIsProcessing(false);
    };

    mediaRecorder.start();
    video.play();

    const duration = video.duration;
    const fps = 30;
    const totalFrames = Math.floor(duration * fps);
    let frameCount = 0;

    const processFrame = () => {
      if (video.ended || video.paused) {
        mediaRecorder.stop();
        return;
      }

      ctx.drawImage(video, 0, 0, srcWidth, srcHeight);
      const imageData = ctx.getImageData(0, 0, srcWidth, srcHeight);

      const upscaledData = bilinearInterpolation(
        imageData.data,
        srcWidth,
        srcHeight,
        dstWidth,
        dstHeight
      );

      const sharpenedData = sharpenFrame(upscaledData, dstWidth, dstHeight);

      const upscaledImageData = new ImageData(sharpenedData, dstWidth, dstHeight);
      outputCtx.putImageData(upscaledImageData, 0, 0);

      frameCount++;
      setProgress(Math.min(99, Math.floor((frameCount / totalFrames) * 100)));

      requestAnimationFrame(processFrame);
    };

    video.addEventListener("ended", () => {
      setTimeout(() => {
        mediaRecorder.stop();
        setProgress(100);
      }, 100);
    });

    processFrame();
  };

  const downloadVideo = () => {
    if (!outputUrl) return;

    const a = document.createElement("a");
    a.href = outputUrl;
    a.download = `upscaled_${scaleFactor}x_${videoFile?.name || "video.webm"}`;
    a.click();
  };

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold text-white mb-4 bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-pink-600">
            Video Upscaler
          </h1>
          <p className="text-gray-300 text-lg">
            Enhance your videos with AI-powered upscaling algorithms
          </p>
        </div>

        <div className="bg-gray-800/50 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-gray-700">
          <div className="mb-8">
            <label className="block text-white font-semibold mb-4 text-lg">
              Upload Video
            </label>
            <input
              type="file"
              accept="video/*"
              onChange={handleFileChange}
              className="block w-full text-white file:mr-4 file:py-3 file:px-6 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-gradient-to-r file:from-purple-500 file:to-pink-500 file:text-white hover:file:from-purple-600 hover:file:to-pink-600 file:cursor-pointer cursor-pointer"
              disabled={isProcessing}
            />
          </div>

          {videoFile && (
            <div className="mb-8">
              <label className="block text-white font-semibold mb-4 text-lg">
                Upscale Factor: {scaleFactor}x
              </label>
              <div className="flex items-center gap-4">
                <input
                  type="range"
                  min="2"
                  max="4"
                  step="1"
                  value={scaleFactor}
                  onChange={(e) => setScaleFactor(Number(e.target.value))}
                  className="flex-1 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
                  disabled={isProcessing}
                />
                <span className="text-white font-mono bg-gray-700 px-4 py-2 rounded-lg">
                  {scaleFactor}x
                </span>
              </div>
              <div className="mt-4 text-gray-300 text-sm">
                <p>
                  Original: {originalDimensions.width} × {originalDimensions.height}
                </p>
                <p className="text-purple-400 font-semibold">
                  Upscaled: {originalDimensions.width * scaleFactor} ×{" "}
                  {originalDimensions.height * scaleFactor}
                </p>
              </div>
            </div>
          )}

          {videoFile && !isProcessing && !outputUrl && (
            <button
              onClick={upscaleVideo}
              className="w-full bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold py-4 px-8 rounded-xl hover:from-purple-600 hover:to-pink-600 transition-all transform hover:scale-105 shadow-lg text-lg"
            >
              Start Upscaling
            </button>
          )}

          {isProcessing && (
            <div className="mb-8">
              <div className="flex justify-between text-white mb-2">
                <span className="font-semibold">Processing...</span>
                <span className="font-mono">{progress}%</span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-4 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-purple-500 to-pink-500 h-4 transition-all duration-300 rounded-full"
                  style={{ width: `${progress}%` }}
                ></div>
              </div>
            </div>
          )}

          {outputUrl && (
            <div className="space-y-6">
              <div className="bg-gray-900/50 rounded-xl p-6 border border-gray-700">
                <h3 className="text-white font-semibold mb-4 text-lg">
                  Upscaled Video Preview
                </h3>
                <video
                  ref={outputVideoRef}
                  src={outputUrl}
                  controls
                  className="w-full rounded-lg shadow-lg"
                />
              </div>

              <button
                onClick={downloadVideo}
                className="w-full bg-gradient-to-r from-green-500 to-emerald-500 text-white font-bold py-4 px-8 rounded-xl hover:from-green-600 hover:to-emerald-600 transition-all transform hover:scale-105 shadow-lg text-lg"
              >
                Download Upscaled Video
              </button>

              <button
                onClick={() => {
                  setVideoFile(null);
                  setOutputUrl(null);
                  setProgress(0);
                }}
                className="w-full bg-gray-700 text-white font-bold py-3 px-8 rounded-xl hover:bg-gray-600 transition-all"
              >
                Process Another Video
              </button>
            </div>
          )}
        </div>

        <div className="mt-12 bg-gray-800/30 backdrop-blur-lg rounded-xl p-6 border border-gray-700">
          <h2 className="text-white font-bold text-xl mb-4">Features</h2>
          <ul className="text-gray-300 space-y-2">
            <li className="flex items-center gap-3">
              <span className="text-purple-400">✓</span>
              Bilinear interpolation for smooth upscaling
            </li>
            <li className="flex items-center gap-3">
              <span className="text-purple-400">✓</span>
              Sharpening filter for enhanced detail
            </li>
            <li className="flex items-center gap-3">
              <span className="text-purple-400">✓</span>
              Support for 2x, 3x, and 4x upscaling
            </li>
            <li className="flex items-center gap-3">
              <span className="text-purple-400">✓</span>
              Real-time processing with progress tracking
            </li>
            <li className="flex items-center gap-3">
              <span className="text-purple-400">✓</span>
              100% client-side processing (privacy-focused)
            </li>
          </ul>
        </div>
      </div>

      <video ref={videoRef} style={{ display: "none" }} />
      <canvas ref={canvasRef} style={{ display: "none" }} />
    </main>
  );
}
