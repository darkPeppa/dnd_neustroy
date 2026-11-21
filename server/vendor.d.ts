declare module "qrcode/lib/core/qrcode.js" {
  const QR: {
    create(
      text: string,
      options?: { errorCorrectionLevel: string },
    ): { modules: { size: number; data: Uint8Array } };
  };
  export default QR;
}
