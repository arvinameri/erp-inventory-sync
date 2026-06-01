import axios from "axios";
import { ExternalApiError } from "../utils/errors.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class HttpClient {
  constructor({
    baseURL,
    timeout = 30000,
    retries = 2,
    retryDelayMs = 800,
    headers = {},
    serviceName = "external-api",
  }) {
    if (!baseURL) {
      throw new Error(`HttpClient baseURL is required for ${serviceName}`);
    }

    this.serviceName = serviceName;
    this.retries = Number(retries);
    this.retryDelayMs = Number(retryDelayMs);

    this.client = axios.create({
      baseURL,
      timeout: Number(timeout),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...headers,
      },
    });
  }

  async post(url, data = {}, config = {}) {
    return this.request({
      method: "POST",
      url,
      data,
      ...config,
    });
  }

  async get(url, config = {}) {
    return this.request({
      method: "GET",
      url,
      ...config,
    });
  }

  async request(config) {
    let lastError;

    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      try {
        const response = await this.client.request(config);
        return response.data;
      } catch (error) {
        lastError = error;

        const status = error?.response?.status;
        const shouldRetry =
          !status || status === 408 || status === 429 || status >= 500;

        if (!shouldRetry || attempt >= this.retries) {
          break;
        }

        const delay = this.retryDelayMs * (attempt + 1);
        await sleep(delay);
      }
    }

    throw ExternalApiError.fromAxiosError(lastError, this.serviceName);
  }
}
