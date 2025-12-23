/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { glob } from 'glob';
import yaml from 'js-yaml';

export interface SkillMetadata {
  name: string;
  description: string;
  location: string; // Absolute path to SKILL.md
}

export interface SkillContent extends SkillMetadata {
  body: string; // The Markdown content after the frontmatter
}

export class SkillDiscoveryService {
  /**
   * Discovers skills in the provided paths.
   * A skill is a directory containing a SKILL.md file at its root.
   */
  async discoverSkills(paths: string[]): Promise<SkillMetadata[]> {
    const skills: SkillMetadata[] = [];
    const seenLocations = new Set<string>();

    for (const searchPath of paths) {
      try {
        const absoluteSearchPath = path.resolve(searchPath);

        // Check if the search path itself is a directory
        const stats = await fs.stat(absoluteSearchPath).catch(() => null);
        if (!stats || !stats.isDirectory()) {
          continue;
        }

        // Search for SKILL.md files in immediate subdirectories
        // We use a depth of 2 to find <searchPath>/<skill-name>/SKILL.md
        const skillFiles = await glob('*/SKILL.md', {
          cwd: absoluteSearchPath,
          absolute: true,
          nodir: true,
        });

        for (const skillFile of skillFiles) {
          if (seenLocations.has(skillFile)) {
            continue;
          }

          const metadata = await this.parseSkillFile(skillFile);
          if (metadata) {
            skills.push(metadata);
            seenLocations.add(skillFile);
          }
        }
      } catch (error) {
        // Silently ignore errors for individual search paths
        console.error(`Error discovering skills in ${searchPath}:`, error);
      }
    }

    return skills;
  }

  /**
   * Reads the full content (metadata + body) of a skill file.
   */
  async getSkillContent(filePath: string): Promise<SkillContent | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');

      // Extract YAML frontmatter
      const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)/);
      if (!match) {
        return null;
      }

      const frontmatter = yaml.load(match[1]);
      if (!frontmatter || typeof frontmatter !== 'object') {
        return null;
      }

      const { name, description } = frontmatter as Record<string, unknown>;
      if (typeof name !== 'string' || typeof description !== 'string') {
        return null;
      }

      return {
        name,
        description,
        location: filePath,
        body: match[2].trim(),
      };
    } catch (error) {
      console.error(`Error reading skill content from ${filePath}:`, error);
      return null;
    }
  }

  private async parseSkillFile(
    filePath: string,
  ): Promise<SkillMetadata | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');

      // Extract YAML frontmatter
      const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
      if (!match) {
        return null;
      }

      const frontmatter = yaml.load(match[1]);
      if (!frontmatter || typeof frontmatter !== 'object') {
        return null;
      }

      const { name, description } = frontmatter as Record<string, unknown>;
      if (typeof name !== 'string' || typeof description !== 'string') {
        return null;
      }

      return {
        name,
        description,
        location: filePath,
      };
    } catch (error) {
      console.error(`Error parsing skill file ${filePath}:`, error);
      return null;
    }
  }
}
