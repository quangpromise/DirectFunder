"use client";

import { useRef, useState } from "react";
import { Camera, X } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { fileToAvatarDataUrl } from "@/lib/image";
import { useT } from "@/lib/i18n";

/** Avatar có thể bấm để đổi/xóa ảnh — dùng ở trang Tài khoản (Admin sửa ảnh cho bất kỳ ai)
 * và ở dropdown profile trên header (tự sửa ảnh của chính mình). */
export function AvatarUpload({
  name,
  color,
  url,
  size = 36,
  onChange,
}: {
  name: string;
  color: string;
  url?: string | null;
  size?: number;
  onChange: (url: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const t = useT();

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError(t("avatar.errNotImage"));
      return;
    }
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      setError("");
      onChange(dataUrl);
    } catch {
      setError(t("avatar.errProcess"));
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="group/avatar relative shrink-0" style={{ width: size, height: size }}>
        <Avatar name={name} color={color} url={url} size={size} />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          title={t("avatar.change")}
          aria-label={t("avatar.change")}
          className="absolute inset-0 flex items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition group-hover/avatar:opacity-100"
        >
          <Camera size={Math.max(12, size * 0.4)} />
        </button>
        {url && (
          <button
            type="button"
            onClick={() => onChange(null)}
            title={t("avatar.remove")}
            aria-label={t("avatar.remove")}
            className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-white shadow"
          >
            <X size={10} />
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            handleFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      {error && <span className="text-[10px] text-red-400">{error}</span>}
    </div>
  );
}
