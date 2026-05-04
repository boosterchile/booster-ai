export class DocumentIndexerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentIndexerError';
  }
}

export class DocumentValidationError extends DocumentIndexerError {
  constructor(
    message: string,
    public readonly fieldErrors: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'DocumentValidationError';
  }
}

export class DocumentNotFoundError extends DocumentIndexerError {
  constructor(
    message: string,
    public readonly id: string,
  ) {
    super(message);
    this.name = 'DocumentNotFoundError';
  }
}

export class DocumentIntegrityError extends DocumentIndexerError {
  constructor(
    message: string,
    public readonly expectedSha256: string,
    public readonly actualSha256: string,
  ) {
    super(message);
    this.name = 'DocumentIntegrityError';
  }
}

export class DocumentRetentionViolationError extends DocumentIndexerError {
  constructor(
    message: string,
    public readonly retentionUntil: Date,
  ) {
    super(message);
    this.name = 'DocumentRetentionViolationError';
  }
}
