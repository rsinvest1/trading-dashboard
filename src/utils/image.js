// Shared image helpers.
//
// `downscaleDataUrl` re-encodes a data: URL through a canvas to cap its largest
// dimension and JPEG quality. Used by the OneNote importer to keep the base64
// chart payload small (the whole store persists to localStorage, ~5MB quota).
// Mirrors the canvas logic in PlaybookPage's `fileToDataUrl`, but takes a data
// URL instead of a File so it can run on images already decoded from an .mht.

/**
 * Downscale a data: URL image. Resolves to a (usually smaller) JPEG data URL.
 * On any failure it resolves to the original input so import never hard-fails.
 *
 * @param {string} dataUrl  source `data:image/...;base64,...` URL
 * @param {number} maxDim   max width/height in px (default 1400)
 * @param {number} quality  JPEG quality 0..1 (default 0.8)
 * @returns {Promise<string>}
 */
export function downscaleDataUrl(dataUrl, maxDim = 1400, quality = 0.8) {
  return new Promise((resolve) => {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) {
      return resolve(dataUrl);
    }
    try {
      const img = new Image();
      img.onload = () => {
        try {
          const longest = Math.max(img.width, img.height) || 1;
          const scale = Math.min(1, maxDim / longest);
          // Already small enough and not an obviously huge PNG → keep as-is.
          if (scale === 1 && dataUrl.length < 400_000) return resolve(dataUrl);
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          const ctx = canvas.getContext('2d');
          // White matte so transparent PNGs don't go black when flattened to JPEG.
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const out = canvas.toDataURL('image/jpeg', quality);
          // Guard against the rare case where re-encoding grew the payload.
          resolve(out.length < dataUrl.length ? out : dataUrl);
        } catch {
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    } catch {
      resolve(dataUrl);
    }
  });
}

/** Rough byte size of a UTF-16/base64 string as stored. */
export function approxByteSize(str) {
  if (!str) return 0;
  // base64 data URLs are ~ASCII; length ≈ bytes is a fine estimate for budgeting.
  return str.length;
}
