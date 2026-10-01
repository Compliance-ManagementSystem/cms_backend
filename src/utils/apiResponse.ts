export interface ApiResponseMeta {
  page?: number;
  limit?: number;
  total?: number;
  totalPages?: number;
  [key: string]: unknown;
}

export class ApiResponse<T = unknown> {
  public readonly success: boolean;
  public readonly statusCode: number;
  public readonly message: string;
  public readonly data: T | null;
  public readonly meta: ApiResponseMeta | null;
  public readonly timestamp: string;

  constructor(
    statusCode: number,
    message: string,
    data: T | null = null,
    meta: ApiResponseMeta | null = null
  ) {
    this.success = statusCode < 400;
    this.statusCode = statusCode;
    this.message = message;
    this.data = data;
    this.meta = meta;
    this.timestamp = new Date().toISOString();
  }

  static ok<T>(message: string, data: T | null = null, meta?: ApiResponseMeta): ApiResponse<T> {
    return new ApiResponse<T>(200, message, data, meta ?? null);
  }

  static success<T>(
    arg1: any,
    arg2: any = null,
    arg3: any = 'Success',
    arg4?: any
  ): any {
    // Mode A: Express Response passed as first argument: ApiResponse.success(res, data, message, meta)
    if (arg1 && typeof arg1.status === 'function' && typeof arg1.json === 'function') {
      const data = arg2;
      const message = typeof arg3 === 'string' ? arg3 : 'Success';
      const meta = arg4 ?? null;
      return arg1.status(200).json(new ApiResponse<T>(200, message, data, meta));
    }

    // Mode B: Data passed as first argument: ApiResponse.success(data, message, statusCode/meta, meta)
    const data = arg1 ?? null;
    const message = typeof arg2 === 'string' ? arg2 : 'Success';
    let statusCode = 200;
    let meta: ApiResponseMeta | null = null;

    if (typeof arg3 === 'number') {
      statusCode = arg3;
      meta = arg4 ?? null;
    } else if (arg3 && typeof arg3 === 'object') {
      meta = arg3;
    } else if (arg4 && typeof arg4 === 'object') {
      meta = arg4;
    }

    return new ApiResponse<T>(statusCode, message, data, meta);
  }

  static created<T>(
    arg1: any,
    arg2: any = null,
    arg3: string = 'Created successfully'
  ): any {
    // If first argument is Express Response
    if (arg1 && typeof arg1.status === 'function' && typeof arg1.json === 'function') {
      return arg1.status(201).json(new ApiResponse<T>(201, arg3, arg2));
    }
    // Otherwise standard static created(message, data)
    return new ApiResponse<T>(201, arg1, arg2);
  }

  static noContent(message = 'No content'): ApiResponse<null> {
    return new ApiResponse<null>(204, message, null);
  }
}
