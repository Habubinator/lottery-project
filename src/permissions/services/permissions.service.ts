import type { AuthorizedUser } from '@auth/types';
import { prisma } from '@database';
import { Request } from 'express';

class PermissionsService {
  async getAll(req: Request) {
    const role = +req.query.roleId;

    const permissions = await prisma.rolePermission.findMany({
      where: role ? { roleId: role } : undefined,
      select: {
        role: true,
        permission: true,
      },
      orderBy: { roleId: 'asc' },
    });

    const result = [];

    const resourceInfo = (resource: string, actionObj) => ({
      name: resource,
      translated: req.__(`permissions.${resource}.resourceName`),
      actions: [actionObj],
    });

    permissions.forEach(({ role, permission }) => {
      const roleIndex = result.findIndex((x) => x.role === role.name);

      const actionObj = {
        id: permission.id,
        name: permission.action,
        translated: req.__(
          `permissions.${permission.resource}.${permission.action}`,
        ),
      };

      if (roleIndex < 0) {
        result.push({
          role: role.name,
          resources: [resourceInfo(permission.resource, actionObj)],
        });
        return;
      }

      const resourceIndex = result[roleIndex].resources.findIndex(
        (x) => x.name === permission.resource,
      );

      if (resourceIndex < 0) {
        result[roleIndex].resources.push(
          resourceInfo(permission.resource, actionObj),
        );
        return;
      }

      result[roleIndex].resources[resourceIndex].actions.push(actionObj);
    });

    return role ? result[0] : result;
  }

  async canAccess(
    user: Pick<AuthorizedUser, 'id' | 'role'>,
    resource: string,
    action: string,
  ) {
    const userPermission = await prisma.userPermissions.findFirst({
      where: {
        userId: user.id,
        rolePermission: {
          roleId: user.role.id,
          permission: { resource, action },
        },
      },
    });

    return !!userPermission;
  }
}

export const permissionsService = new PermissionsService();
