"use client";

import { useEffect, useRef, useState } from "react";
import AnnouncementBar from "@/components/AnnouncementBar";
import SiteHeader from "@/components/SiteHeader";
import UploadZone from "@/components/UploadZone";
import ResultPanel from "@/components/ResultPanel";
import { resizeImage } from "@/lib/resizeImage";

export default function Page() {
  const [image1, setImage1] = useState<File | null>(null);
  const [image2, setImage2] = useState<File | null>(null);
  const [preview1, setPreview1] = useState<string | null>(null);
  const [preview2, setPreview2] = useState<string | null>(null);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mirror of the live object URLs so unmount cleanup sees current values
  // without re-running on every change.
  const urls = useRef<(string | null)[]>([]);
  urls.current = [preview1, preview2, resultImage];
  useEffect(() => {
    return () => {
      urls.current.forEach((url) => url && URL.revokeObjectURL(url));
    };
  }, []);

  const handleSelect = async (slot: 1 | 2, file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("That file is not an image. Please choose a JPG or PNG.");
      return;
    }
    setError(null);

    const resized = await resizeImage(file);
    const url = URL.createObjectURL(resized);

    if (slot === 1) {
      if (preview1) URL.revokeObjectURL(preview1);
      setImage1(resized);
      setPreview1(url);
    } else {
      if (preview2) URL.revokeObjectURL(preview2);
      setImage2(resized);
      setPreview2(url);
    }
  };

  const handleClear = (slot: 1 | 2) => {
    if (slot === 1) {
      if (preview1) URL.revokeObjectURL(preview1);
      setImage1(null);
      setPreview1(null);
    } else {
      if (preview2) URL.revokeObjectURL(preview2);
      setImage2(null);
      setPreview2(null);
    }
  };

  const handleSubmit = async () => {
    if (!image1 || !image2) return;

    setIsLoading(true);
    setError(null);
    if (resultImage) {
      URL.revokeObjectURL(resultImage);
      setResultImage(null);
    }

    try {
      const formData = new FormData();
      formData.append("image1", image1);
      formData.append("image2", image2);

      const res = await fetch("/api/tryon", { method: "POST", body: formData });

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(detail || `Request failed (${res.status}).`);
      }

      const blob = await res.blob();
      if (blob.size === 0 || !blob.type.startsWith("image/")) {
        throw new Error("The service did not return an image.");
      }

      setResultImage(URL.createObjectURL(blob));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setIsLoading(false);
    }
  };

  const canGenerate = Boolean(image1 && image2) && !isLoading;

  return (
    <main className="min-h-screen">
      <AnnouncementBar />
      <SiteHeader />

      {/* Page heading — mirrors the "NEW ARRIVALS" block */}
      <div className="px-6 pt-10 pb-6">
        <h1 className="text-4xl font-bold tracking-tight uppercase">
          Virtual Try-On
        </h1>
        <p className="mt-3 text-[15px] text-ink">
          Upload your photo and a garment to see how it looks on you.
        </p>
        <nav className="mt-4 text-sm text-muted" aria-label="Breadcrumb">
          <span>Home</span>
          <span className="px-2">/</span>
          <span>Virtual Try-On</span>
        </nav>
      </div>

      {/* Label row — mirrors the "SORT GENDER SIZE…" filter bar */}
      <div className="border-t border-b border-hairline px-6 py-4">
        <div className="flex flex-wrap items-center gap-8 text-xs font-medium tracking-widest uppercase">
          <span>Step 1 — Your Photo</span>
          <span>Step 2 — The Garment</span>
          <span>Step 3 — Generate</span>
        </div>
      </div>

      <div className="px-6 py-10">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <UploadZone
            label="Your Photo"
            hint="Full-body shot, JPG or PNG"
            preview={preview1}
            disabled={isLoading}
            onSelect={(file) => handleSelect(1, file)}
            onClear={() => handleClear(1)}
          />
          <UploadZone
            label="The Garment"
            hint="Product image, JPG or PNG"
            preview={preview2}
            disabled={isLoading}
            onSelect={(file) => handleSelect(2, file)}
            onClear={() => handleClear(2)}
          />
        </div>

        <div className="mt-10 flex flex-col items-center">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canGenerate}
            className={[
              "flex w-full items-center justify-center gap-3 px-12 py-4 text-xs font-bold tracking-widest uppercase md:w-auto md:min-w-[320px]",
              canGenerate
                ? "bg-ink text-white hover:opacity-85"
                : "cursor-not-allowed bg-hairline text-muted",
            ].join(" ")}
          >
            {isLoading && (
              <svg
                viewBox="0 0 24 24"
                fill="none"
                className="h-4 w-4"
                style={{ animation: "tryon-spin 0.9s linear infinite" }}
              >
                <circle
                  cx="12"
                  cy="12"
                  r="9"
                  stroke="currentColor"
                  strokeOpacity="0.25"
                  strokeWidth="2"
                />
                <path
                  d="M21 12a9 9 0 0 0-9-9"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            )}
            {isLoading ? "Generating…" : "Generate"}
          </button>
          <p className="mt-3 text-xs text-muted">
            This usually takes 20–40 seconds.
          </p>
        </div>
      </div>

      <div className="border-t border-hairline px-6 py-10">
        <h2 className="mb-6 text-xs font-bold tracking-widest uppercase">
          The Result
        </h2>

        {error && (
          <div
            role="alert"
            className="mb-6 border border-hairline px-5 py-4"
          >
            <p className="text-xs font-bold tracking-widest uppercase">
              Could not generate
            </p>
            <p className="mt-2 text-sm text-muted">{error}</p>
          </div>
        )}

        <ResultPanel resultImage={resultImage} isLoading={isLoading} />
      </div>
    </main>
  );
}
