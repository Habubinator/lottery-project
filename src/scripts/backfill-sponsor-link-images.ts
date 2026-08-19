/**
 * Script to backfill preview images for sponsor links
 *
 * Usage:
 *   npx tsx src/scripts/backfill-sponsor-link-images.ts
 *   npx tsx src/scripts/backfill-sponsor-link-images.ts --dry-run
 *   npx tsx src/scripts/backfill-sponsor-link-images.ts --force
 *
 * Flags:
 *   --dry-run: Preview what would be updated without making changes
 *   --force: Re-fetch images for all sponsor links (even those with existing images)
 */

import { prisma } from '@database';
import { fetchLinkPreviewImage } from '@common/utils';

// Parse command line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isForce = args.includes('--force');

// Delay between requests to avoid overwhelming servers
const DELAY_MS = 100;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function backfillSponsorLinkImages() {
  try {
    console.log('Starting sponsor link images backfill script...\n');

    if (isDryRun) {
      console.log('🔍 DRY RUN MODE - No changes will be made\n');
    }

    if (isForce) {
      console.log('🔄 FORCE MODE - Re-fetching all images\n');
    }

    // Find sponsor links that need images
    const whereClause = isForce
      ? {} // Get all sponsor links
      : { imageUrl: null }; // Only get links without images

    const sponsorLinks = await prisma.sponsorLink.findMany({
      where: whereClause,
      select: {
        id: true,
        title: true,
        link: true,
        imageUrl: true,
      },
      orderBy: {
        id: 'asc',
      },
    });

    if (sponsorLinks.length === 0) {
      console.log('✓ No sponsor links need image updates. All links are up to date!');
      return;
    }

    console.log(`Found ${sponsorLinks.length} sponsor link(s) needing images:\n`);

    let successCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    const failedLinks: Array<{
      id: number;
      title: string;
      link: string;
      reason: string;
    }> = [];

    // Process each sponsor link
    for (const sponsorLink of sponsorLinks) {
      try {
        console.log(
          `[${successCount + skippedCount + failedCount + 1}/${sponsorLinks.length}] ` +
          `Processing: ${sponsorLink.title || 'Untitled'} (ID: ${sponsorLink.id})`
        );
        console.log(`  URL: ${sponsorLink.link}`);

        if (isDryRun) {
          console.log('  [DRY RUN] Would fetch preview image\n');
          successCount++;
          continue;
        }

        // Fetch preview image
        const result = await fetchLinkPreviewImage(sponsorLink.link);

        if (result.success && result.imageUrl) {
          // Update the sponsor link with the image URL
          await prisma.sponsorLink.update({
            where: { id: sponsorLink.id },
            data: { imageUrl: result.imageUrl },
          });

          console.log(`  ✓ Success: ${result.imageUrl}\n`);
          successCount++;
        } else if (!result.success) {
          console.log(`  ✗ Failed: ${result.error || 'No image found'}\n`);
          failedCount++;
          failedLinks.push({
            id: sponsorLink.id,
            title: sponsorLink.title,
            link: sponsorLink.link,
            reason: result.error || 'No image found in preview',
          });
        } else {
          console.log(`  ⊘ Skipped: No image available\n`);
          skippedCount++;
        }

        // Add delay between requests
        await sleep(DELAY_MS);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.log(`  ✗ Error: ${errorMessage}\n`);
        failedCount++;
        failedLinks.push({
          id: sponsorLink.id,
          title: sponsorLink.title,
          link: sponsorLink.link,
          reason: errorMessage,
        });
      }
    }

    // Print summary
    console.log('═'.repeat(60));
    console.log('SUMMARY');
    console.log('═'.repeat(60));
    console.log(`Total sponsor links processed: ${sponsorLinks.length}`);
    console.log(`✓ Successfully updated: ${successCount}`);
    console.log(`⊘ Skipped (no image): ${skippedCount}`);
    console.log(`✗ Failed: ${failedCount}`);
    console.log('═'.repeat(60));

    // Print failed links details if any
    if (failedLinks.length > 0) {
      console.log('\nFailed links details:');
      console.log('='.repeat(60));
      failedLinks.forEach((link, index) => {
        console.log(`${index + 1}. ${link.title || 'Untitled'} (ID: ${link.id})`);
        console.log(`   URL: ${link.link}`);
        console.log(`   Reason: ${link.reason}`);
      });
      console.log('='.repeat(60));
      console.log('\nCommon reasons for failure:');
      console.log('• URL is unreachable or returns error');
      console.log('• Website blocks automated requests');
      console.log('• No Open Graph images or meta tags found');
      console.log('• Network timeout (default: 5 seconds)');
    }

    if (isDryRun) {
      console.log('\n🔍 DRY RUN completed - No actual changes were made');
      console.log('   Run without --dry-run flag to apply changes');
    } else {
      console.log('\nScript completed!');
    }
  } catch (error) {
    console.error('Fatal error in backfill script:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
backfillSponsorLinkImages()
  .then(() => {
    console.log('\n✓ Script execution finished successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n✗ Script execution failed:', error);
    process.exit(1);
  });
