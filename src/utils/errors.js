export class AppError extends Error {
  constructor(message, statusCode = 500, details = null) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;

    Error.captureStackTrace?.(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message, details = null) {
    super(message, 400, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found", details = null) {
    super(message, 404, details);
  }
}

export class ExternalApiError extends AppError {
  constructor(message, serviceName, statusCode = 502, details = null) {
    super(message, statusCode, details);
    this.serviceName = serviceName;
  }

  static fromAxiosError(error, serviceName = "external-api") {
    const status = error?.response?.status;
    const responseData = error?.response?.data;

    return new ExternalApiError(
      `${serviceName} request failed`,
      serviceName,
      status && status >= 400 && status < 500 ? 502 : 503,
      {
        httpStatus: status,
        response: responseData,
        message: error?.message,
        code: error?.code,
      },
    );
  }
}
