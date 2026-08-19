import { prisma } from '@database';
import { HttpException } from '@common/exceptions';
import { ErrorCodes } from '@common/enums';
import { CreateTemplateDto, UpdateTemplateNameDto } from '../dto';
import { GIVEAWAY_LINKED_PRIZES_INCLUDE } from '../../giveaways/services/prize-include';

class TemplateService {
  /**
   * Create template from giveaway
   */
  async create(userId: number, dto: CreateTemplateDto) {
    // Verify giveaway exists
    const giveaway = await prisma.giveaway.findUnique({
      where: { id: dto.giveawayId },
    });

    if (!giveaway) {
      throw HttpException.BadRequest(
        ErrorCodes.NotFound,
        'Giveaway not found',
      );
    }

    // Check if template already exists for this user and giveaway
    const existingTemplate = await prisma.template.findFirst({
      where: {
        userId,
        giveawayId: dto.giveawayId,
      },
    });

    if (existingTemplate) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'Template already exists for this giveaway',
      );
    }

    // Create template
    const template = await prisma.template.create({
      data: {
        userId,
        giveawayId: dto.giveawayId,
        name: dto.name,
      },
      include: {
        giveaway: {
          include: {
            createdBy: {
              select: {
                id: true,
                username: true,
                first_name: true,
                last_name: true,
                photo_url: true,
              },
            },
            boostedChannel: true,
            sponsoredBy: {
              include: {
                sponsorChannel: true,
                sponsorLink: true,
              },
            },
            linkedChannels: {
              include: {
                channel: true,
              },
            },
          },
        },
      },
    });

    return template;
  }

  /**
   * Delete template by owner
   */
  async delete(templateId: string, userId: number) {
    // Find template
    const template = await prisma.template.findUnique({
      where: { id: templateId },
    });

    if (!template) {
      throw HttpException.BadRequest(
        ErrorCodes.NotFound,
        'Template not found',
      );
    }

    // Check ownership
    if (template.userId !== userId) {
      throw HttpException.Forbidden(
        ErrorCodes.Forbidden,
        'You are not authorized to delete this template',
      );
    }

    // Delete template
    await prisma.template.delete({
      where: { id: templateId },
    });

    return { success: true };
  }

  /**
   * Get all templates of request user
   */
  async getAllUserTemplates(userId: number) {
    const templates = await prisma.template.findMany({
      where: { userId },
      include: {
        giveaway: {
          include: {
            createdBy: {
              select: {
                id: true,
                username: true,
                first_name: true,
                last_name: true,
                photo_url: true,
              },
            },
            boostedChannel: true,
            sponsoredBy: {
              include: {
                sponsorChannel: true,
                sponsorLink: true,
              },
            },
            linkedChannels: {
              include: {
                channel: true,
              },
            },
            prizes: GIVEAWAY_LINKED_PRIZES_INCLUDE,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return templates;
  }

  /**
   * Get one users template of request user
   */
  async getOneUserTemplate(templateId: string, userId: number) {
    const template = await prisma.template.findUnique({
      where: { id: templateId },
      include: {
        giveaway: {
          include: {
            createdBy: {
              select: {
                id: true,
                username: true,
                first_name: true,
                last_name: true,
                photo_url: true,
              },
            },
            boostedChannel: true,
            sponsoredBy: {
              include: {
                sponsorChannel: true,
                sponsorLink: true,
              },
            },
            linkedChannels: {
              include: {
                channel: true,
              },
            },
          },
        },
      },
    });

    if (!template) {
      throw HttpException.BadRequest(
        ErrorCodes.NotFound,
        'Template not found',
      );
    }

    // Check ownership
    if (template.userId !== userId) {
      throw HttpException.Forbidden(
        ErrorCodes.Forbidden,
        'You are not authorized to access this template',
      );
    }

    return template;
  }

  /**
   * Check if template exists for giveaway
   */
  async checkTemplateExists(giveawayId: string, userId: number) {
    const template = await prisma.template.findFirst({
      where: {
        userId,
        giveawayId,
      },
      select: {
        id: true,
      },
    });

    return {
      exists: !!template,
      templateId: template?.id || null,
    };
  }

  /**
   * Update template name by owner
   */
  async updateName(templateId: string, userId: number, dto: UpdateTemplateNameDto) {
    // Find template
    const template = await prisma.template.findUnique({
      where: { id: templateId },
    });

    if (!template) {
      throw HttpException.BadRequest(
        ErrorCodes.NotFound,
        'Template not found',
      );
    }

    // Check ownership
    if (template.userId !== userId) {
      throw HttpException.Forbidden(
        ErrorCodes.Forbidden,
        'You are not authorized to update this template',
      );
    }

    // Update template name
    const updatedTemplate = await prisma.template.update({
      where: { id: templateId },
      data: { name: dto.name },
      include: {
        giveaway: {
          include: {
            createdBy: {
              select: {
                id: true,
                username: true,
                first_name: true,
                last_name: true,
                photo_url: true,
              },
            },
            boostedChannel: true,
            sponsoredBy: {
              include: {
                sponsorChannel: true,
                sponsorLink: true,
              },
            },
            linkedChannels: {
              include: {
                channel: true,
              },
            },
          },
        },
      },
    });

    return updatedTemplate;
  }

  /**
   * Search user's templates by name
   */
  async searchByName(userId: number, searchQuery: string) {
    const trimmedQuery = searchQuery.trim();

    if (!trimmedQuery) {
      // If empty search, return all templates
      return this.getAllUserTemplates(userId);
    }

    const templates = await prisma.template.findMany({
      where: {
        userId,
        name: {
          contains: trimmedQuery,
          mode: 'insensitive', // Case-insensitive search
        },
      },
      include: {
        giveaway: {
          include: {
            createdBy: {
              select: {
                id: true,
                username: true,
                first_name: true,
                last_name: true,
                photo_url: true,
              },
            },
            boostedChannel: true,
            sponsoredBy: {
              include: {
                sponsorChannel: true,
                sponsorLink: true,
              },
            },
            linkedChannels: {
              include: {
                channel: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return templates;
  }
}

export const templateService = new TemplateService();
