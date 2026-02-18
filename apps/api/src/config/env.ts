import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

const candidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), 'apps', 'api', '.env'),
];

for (const candidate of candidates) {
  if (fs.existsSync(candidate)) {
    dotenv.config({ path: candidate });
    break;
  }
}
