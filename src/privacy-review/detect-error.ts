export class DetectSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DetectSetupError';
  }
}
