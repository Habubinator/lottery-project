import { prisma } from '@database';
import { HttpException } from '@common/exceptions';
import { ErrorCodes } from '@common/enums';

class SponsorLinkService {
  /**
   * Track a sponsor link visit and return the actual URL to redirect to
   */
  async trackVisitAndRedirect(
    userId: number,
    giveawayId: string,
    sponsorLinkId: number,
  ): Promise<string> {
    // Verify the sponsor link exists and belongs to the giveaway
    const sponsor = await prisma.sponsors.findFirst({
      where: {
        giveawayId,
        sponsorLinkId,
        sponsorType: 'Link',
      },
      include: {
        sponsorLink: true,
      },
    });

    if (!sponsor || !sponsor.sponsorLink) {
      throw HttpException.BadRequest(
        ErrorCodes.NotFound,
        'Sponsor link not found for this giveaway',
      );
    }

    // Create or update the visit record (upsert for idempotency)
    await prisma.sponsorLinkVisit.upsert({
      where: {
        userId_giveawayId_sponsorLinkId: {
          userId,
          giveawayId,
          sponsorLinkId,
        },
      },
      update: {
        visitedAt: new Date(),
      },
      create: {
        userId,
        giveawayId,
        sponsorLinkId,
      },
    });

    // Return the actual URL to redirect to
    return sponsor.sponsorLink.link;
  }

  /**
   * Get sponsor links that the user hasn't visited for a specific giveaway
   */
  async getUnvisitedSponsorLinks(
    userId: number,
    giveawayId: string,
  ): Promise<any[]> {
    // Get all sponsor links for the giveaway
    const sponsors = await prisma.sponsors.findMany({
      where: {
        giveawayId,
        sponsorType: 'Link',
        sponsorLinkId: {
          not: null,
        },
      },
      include: {
        sponsorLink: true,
      },
    });

    // Get all sponsor links the user has visited
    const visits = await prisma.sponsorLinkVisit.findMany({
      where: {
        userId,
        giveawayId,
      },
      select: {
        sponsorLinkId: true,
      },
    });

    const visitedLinkIds = new Set(visits.map((v) => v.sponsorLinkId));

    // Filter out visited links
    const unvisitedLinks = sponsors
      .filter((sponsor) => !visitedLinkIds.has(sponsor.sponsorLinkId!))
      .map((sponsor) => sponsor.sponsorLink);

    return unvisitedLinks;
  }

  /**
   * Check if the user has visited all required sponsor links for a giveaway
   */
  async hasVisitedAllSponsorLinks(
    userId: number,
    giveawayId: string,
  ): Promise<boolean> {
    // Get count of all sponsor links for the giveaway
    const totalSponsorLinks = await prisma.sponsors.count({
      where: {
        giveawayId,
        sponsorType: 'Link',
        sponsorLinkId: {
          not: null,
        },
      },
    });

    // If there are no sponsor links, validation passes
    if (totalSponsorLinks === 0) {
      return true;
    }

    // Get count of sponsor links the user has visited
    const visitedCount = await prisma.sponsorLinkVisit.count({
      where: {
        userId,
        giveawayId,
      },
    });

    // User must have visited all sponsor links
    return visitedCount >= totalSponsorLinks;
  }
}

export const sponsorLinkService = new SponsorLinkService();
