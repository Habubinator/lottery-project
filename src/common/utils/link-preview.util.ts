import { getLinkPreview } from 'link-preview-js';

interface LinkPreviewResult {
  imageUrl: string | null;
  success: boolean;
  error?: string;
}

/**
 * Fetches the preview image URL for a given link
 * @param url - The URL to fetch preview for
 * @param timeout - Timeout in milliseconds (default: 5000)
 * @returns Promise with imageUrl or null if failed
 */
export async function fetchLinkPreviewImage(
  url: string,
  timeout: number = 5000,
): Promise<LinkPreviewResult> {
  try {
    // Validate URL format
    new URL(url);

    // Fetch link preview with timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Preview fetch timeout')), timeout);
    });

    const previewPromise = getLinkPreview(url, {
      followRedirects: 'follow',
      timeout: timeout,
    });

    const preview = await Promise.race([previewPromise, timeoutPromise]);

    // Extract image URL from preview data
    let imageUrl: string | null = null;

    if (
      'images' in preview &&
      Array.isArray(preview.images) &&
      preview.images.length > 0
    ) {
      imageUrl = preview.images[0];
    } else if (
      'favicons' in preview &&
      Array.isArray(preview.favicons) &&
      preview.favicons.length > 0
    ) {
      // Fallback to favicon if no images found
      imageUrl = preview.favicons[0];
    }

    return {
      imageUrl,
      success: true,
    };
  } catch (error) {
    console.warn(
      `Failed to fetch link preview for ${url}:`,
      error instanceof Error ? error.message : String(error),
    );
    return {
      imageUrl: null,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Updates a sponsor link with its preview image
 * @param linkId - The sponsor link ID
 * @param url - The URL to fetch preview for
 * @param prismaClient - Prisma client instance
 */
export async function updateSponsorLinkImage(
  linkId: number,
  url: string,
  prismaClient: any, // Use PrismaClient type from @database
): Promise<void> {
  try {
    const result = await fetchLinkPreviewImage(url);

    if (result.success && result.imageUrl) {
      await prismaClient.sponsorLink.update({
        where: { id: linkId },
        data: { imageUrl: result.imageUrl },
      });
      console.log(`✓ Updated preview image for sponsor link ${linkId}`);
    }
  } catch (error) {
    console.error(`Failed to update sponsor link ${linkId} image:`, error);
    // Don't throw - this is a background operation
  }
}
