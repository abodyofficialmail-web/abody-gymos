/** アップロード前に JPEG へ圧縮（フォルダ選択の高解像度・HEIC 対策） */
export async function compressImageFile(
  file: File,
  options?: { maxDim?: number; quality?: number }
): Promise<File> {
  const maxDim = options?.maxDim ?? 1920;
  const quality = options?.quality ?? 0.85;

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width >= height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("画像の処理に失敗しました"));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("画像の圧縮に失敗しました"));
            return;
          }
          const base = file.name.replace(/\.[^.]+$/, "") || "photo";
          resolve(
            new File([blob], `${base}.jpg`, {
              type: "image/jpeg",
              lastModified: Date.now(),
            })
          );
        },
        "image/jpeg",
        quality
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("画像を読み込めませんでした"));
    };

    img.src = url;
  });
}
