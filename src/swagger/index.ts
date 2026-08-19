import swaggerjsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { SWAGGER_OPTIONS, IS_PRODUCTION } from '@common/constants';
import type { Express } from 'express';
import yaml from 'js-yaml';

export function useSwagger(route: string, app: Express) {
  if (!IS_PRODUCTION) {
    const swaggerDocs = swaggerjsdoc(SWAGGER_OPTIONS);

    // HTML UI
    app.use(route, swaggerUi.serve, swaggerUi.setup(swaggerDocs));

    // JSON route
    app.get(`${route}.json`, (_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.send(swaggerDocs);
    });

    // YAML route
    app.get(`${route}.yaml`, (_req, res) => {
      res.setHeader('Content-Type', 'text/yaml');
      res.send(yaml.dump(swaggerDocs));
    });
  }
}
