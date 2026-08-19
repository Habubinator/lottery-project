import axios from 'axios';
import path from 'path';
import fs from 'fs';
import { queueTelegramRequest } from '../../bot/utils/telegram-queue';
import { downloadFile } from '../../common/utils/file.util';

const BOT_TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

/**
 * Telegram file thumbnail
 * @see https://core.telegram.org/bots/api#photosize
 */
interface TelegramThumbnail {
  file_id: string;
  file_unique_id: string;
  file_size: number;
  width: number;
  height: number;
}

/**
 * Telegram sticker interface matching actual API response
 * @see https://core.telegram.org/bots/api#sticker
 */
interface TelegramSticker {
  file_id: string;
  file_unique_id: string;
  type: string;
  width: number;
  height: number;
  is_animated: boolean;
  is_video: boolean;
  file_size?: number;
  custom_emoji_id?: string;
  thumbnail?: TelegramThumbnail;
  thumb?: TelegramThumbnail; // Deprecated but still returned by API
  emoji?: string;
  set_name?: string;
  premium_animation?: any;
}

/**
 * Telegram gift object from getAvailableGifts API
 */
interface TelegramGift {
  id: string;
  sticker: TelegramSticker;
  star_count: number;
  upgrade_star_count?: number;
  total_count?: number;
  remaining_count?: number;
  publisher_chat?: any;
}

/**
 * Telegram File response from getFile API
 * @see https://core.telegram.org/bots/api#file
 */
interface TelegramFile {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
}

interface TelegramFileResponse {
  ok: boolean;
  result: TelegramFile;
}

interface TelegramGiftsResponse {
  ok: boolean;
  result: {
    gifts: TelegramGift[];
  };
}

/**
 * Extended gift interface for API response
 * Includes URL to sticker image on disk
 */
interface TelegramGiftWithImage extends TelegramGift {
  imageUrl?: string;
}

class TelegramGiftService {
  private cache: {
    gifts: TelegramGiftWithImage[] | null;
    timestamp: number | null;
  } = {
    gifts: null,
    timestamp: null,
  };

  private readonly CACHE_TTL = 3600000; // 1 hour in milliseconds

  /**
   * Get all available Telegram gifts with sticker images as base64
   * @returns Promise<TelegramGiftWithImage[]> - Array of gifts with base64 images
   */
  async getAll(options?: { forceRefresh?: boolean }): Promise<TelegramGiftWithImage[]> {
    try {
      // Check cache first
      if (
        !options?.forceRefresh &&
        this.cache.gifts &&
        this.cache.timestamp &&
        Date.now() - this.cache.timestamp < this.CACHE_TTL
      ) {
        console.log('Returning cached Telegram gifts');
        return this.cache.gifts;
      }

      if (!BOT_TOKEN) {
        throw new Error('BOT_TOKEN environment variable is not set');
      }

      // Fetch all gifts from Telegram API
      const response = await queueTelegramRequest(() =>
        axios.get<TelegramGiftsResponse>(
          `${TELEGRAM_API_BASE}/getAvailableGifts`,
          {
            timeout: 15000,
          },
        ),
      );

      if (!response.data.ok) {
        console.error('Failed to fetch Telegram gifts:', response.data);
        throw new Error('Failed to fetch gifts from Telegram API');
      }

      const gifts = response.data.result.gifts;

      // Map gifts to include imageUrl by checking disk for existing files
      const giftsWithImages = gifts.map((gift): TelegramGiftWithImage => {
        const giftsDir = path.join(process.env.MULTER_DEST!, 'gifts');

        // Check for common extensions (.webp, .tgs)
        const possibleExtensions = ['.webp', '.tgs'];
        let imageUrl: string | undefined;

        for (const ext of possibleExtensions) {
          const filename = `${gift.id}${ext}`;
          const filePath = path.join(giftsDir, filename);

          if (fs.existsSync(filePath)) {
            imageUrl = `/static/gifts/${filename}`;
            break;
          }
        }

        return {
          ...gift,
          imageUrl,
        };
      });

      const giftsWithUrls = giftsWithImages.filter((g) => g.imageUrl).length;
      console.log(`${giftsWithUrls}/${gifts.length} gifts have images available`);

      // Update cache
      this.cache.gifts = giftsWithImages;
      this.cache.timestamp = Date.now();

      // Download images for any new gifts missing from disk (background, non-blocking)
      const missingGifts = giftsWithImages.filter((g) => !g.imageUrl);
      if (missingGifts.length > 0) {
        console.log(`[TelegramGiftService] Downloading images for ${missingGifts.length} new gifts in background`);
        Promise.allSettled(
          missingGifts.map(async (gift) => {
            const imageUrl = await this.downloadStickerToDisk(gift.sticker.file_id, gift.id);
            if (imageUrl && this.cache.gifts) {
              const idx = this.cache.gifts.findIndex((g) => g.id === gift.id);
              if (idx !== -1) this.cache.gifts[idx].imageUrl = imageUrl;
            }
          }),
        ).then(() => {
          console.log(`[TelegramGiftService] Background image download complete`);
        });
      }

      return giftsWithImages;
    } catch (error: any) {
      console.error('Error fetching Telegram gifts:', error.message);
      throw error;
    }
  }

  /**
   * Downloads a sticker file from Telegram and saves it to disk
   * @param fileId - Telegram file_id of the sticker
   * @param giftId - Gift ID to use as filename
   * @returns Promise<string | undefined> - URL path or undefined if download fails
   */
  private async downloadStickerToDisk(
    fileId: string,
    giftId: string,
  ): Promise<string | undefined> {
    try {
      // Step 1: Get file path from Telegram
      const fileResponse = await queueTelegramRequest(() =>
        axios.get<TelegramFileResponse>(`${TELEGRAM_API_BASE}/getFile`, {
          params: { file_id: fileId },
          timeout: 10000,
        }),
      );

      if (!fileResponse.data.ok || !fileResponse.data.result.file_path) {
        console.error(`Failed to get file path for file_id: ${fileId}`);
        return undefined;
      }

      const filePath = fileResponse.data.result.file_path;
      const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;

      // Extract extension from Telegram's file_path (e.g., "stickers/file.webp" -> ".webp")
      const extension = path.extname(filePath);
      const filename = `${giftId}${extension}`;
      const destPath = path.join(process.env.MULTER_DEST!, 'gifts', filename);

      // Step 2: Check if file already exists (skip re-download)
      if (fs.existsSync(destPath)) {
        console.log(`Gift image already exists: ${filename}`);
        return `/static/gifts/${filename}`;
      }

      // Step 3: Download file to disk using existing utility
      await downloadFile(fileUrl, destPath);
      console.log(`Successfully downloaded gift image: ${filename}`);

      return `/static/gifts/${filename}`;
    } catch (error: any) {
      console.error(`Error downloading sticker ${fileId}:`, error.message);
      return undefined;
    }
  }

  /**
   * Resolves `/static/gifts/{id}.tgs|.webp` for a catalog gift, downloading if missing.
   */
  async resolveCatalogGiftImageUrl(
    telegramGiftId: string,
  ): Promise<string | undefined> {
    const gifts = await this.getAll().catch(() => []);
    const gift = gifts.find((g) => g.id === telegramGiftId);
    if (!gift) return undefined;
    if (gift.imageUrl) return gift.imageUrl;
    return this.downloadStickerToDisk(gift.sticker.file_id, gift.id);
  }

  /**
   * Initialize gift images on application startup
   * Downloads all gift sticker images to disk if they don't already exist
   * Runs asynchronously without blocking server startup
   */
  async initializeGiftImages(): Promise<void> {
    try {
      console.log('[TelegramGiftService] Starting gift images initialization...');

      if (!BOT_TOKEN) {
        console.error(
          '[TelegramGiftService] BOT_TOKEN not set, skipping initialization',
        );
        return;
      }

      // Ensure gifts directory exists
      const giftsDir = path.join(process.env.MULTER_DEST!, 'gifts');
      await fs.promises.mkdir(giftsDir, { recursive: true });
      console.log(`[TelegramGiftService] Ensured directory exists: ${giftsDir}`);

      // Fetch all gifts from Telegram API
      const response = await queueTelegramRequest(() =>
        axios.get<TelegramGiftsResponse>(
          `${TELEGRAM_API_BASE}/getAvailableGifts`,
          { timeout: 15000 },
        ),
      );

      if (!response.data.ok) {
        console.error(
          '[TelegramGiftService] Failed to fetch gifts:',
          response.data,
        );
        return;
      }

      const gifts = response.data.result.gifts;
      console.log(`[TelegramGiftService] Found ${gifts.length} gifts to process`);

      // Download all sticker images in parallel (rate-limited by queueTelegramRequest)
      const results = await Promise.allSettled(
        gifts.map(async (gift) => {
          const imageUrl = await this.downloadStickerToDisk(
            gift.sticker.file_id,
            gift.id,
          );
          return { giftId: gift.id, imageUrl };
        }),
      );

      // Count successes and failures
      const successful = results.filter(
        (r) => r.status === 'fulfilled' && r.value.imageUrl,
      ).length;
      const failed = results.length - successful;

      console.log(
        `[TelegramGiftService] Initialization complete: ${successful} succeeded, ${failed} failed`,
      );
    } catch (error: any) {
      console.error(
        '[TelegramGiftService] Error during initialization:',
        error.message,
      );
      // Don't throw - let the server continue starting
    }
  }
}

export const telegramGiftService = new TelegramGiftService();
