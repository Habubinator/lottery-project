import PQueue from 'p-queue';

// Telegram rate limits: ~30 messages/second globally
const telegramQueue = new PQueue({
  concurrency: 30,
  interval: 1000,
  intervalCap: 30,
});

export async function queueTelegramRequest<T>(
  fn: () => Promise<T>,
  retries = 3,
): Promise<T> {
  return telegramQueue.add(async () => {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        if (error.response?.data?.error_code === 429 && attempt < retries) {
          const retryAfter = error.response.data.parameters?.retry_after || 60;
          console.warn(
            `Rate limited, retrying after ${retryAfter}s (attempt ${attempt}/${retries})`,
          );
          await new Promise((resolve) =>
            setTimeout(resolve, retryAfter * 1000),
          );
          continue;
        }
        // Retry transient network errors (socket hang up, ECONNRESET, ETIMEDOUT)
        const isNetworkError =
          !error.response &&
          (error.message?.includes('socket hang up') ||
            error.code === 'ECONNRESET' ||
            error.message?.includes('ECONNRESET') ||
            error.code === 'ETIMEDOUT' ||
            error.message?.includes('ETIMEDOUT'));
        if (isNetworkError && attempt < retries) {
          console.warn(
            `Network error, retrying in 3s (attempt ${attempt}/${retries}): ${error.message}`,
          );
          await new Promise((resolve) => setTimeout(resolve, 3000));
          continue;
        }
        throw error;
      }
    }
    throw new Error('Max retries exceeded');
  });
}

export { telegramQueue };
