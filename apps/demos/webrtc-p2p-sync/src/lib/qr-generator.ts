/**
 * QR code generation utilities.
 */

import QRCode from "qrcode";

/**
 * Generate a QR code as a data URL.
 *
 * @param text The text to encode in the QR code
 * @returns Promise resolving to a data URL (image/png base64)
 */
export async function generateQrCodeDataUrl(text: string): Promise<string> {
  return await QRCode.toDataURL(text, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 200,
    color: {
      dark: "#000000",
      light: "#ffffff",
    },
  });
}

/**
 * Generate a QR code and render it to a canvas element.
 *
 * @param canvas The canvas element to render to
 * @param text The text to encode in the QR code
 */
export async function renderQrCodeToCanvas(canvas: HTMLCanvasElement, text: string): Promise<void> {
  await QRCode.toCanvas(canvas, text, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 200,
    color: {
      dark: "#000000",
      light: "#ffffff",
    },
  });
}
