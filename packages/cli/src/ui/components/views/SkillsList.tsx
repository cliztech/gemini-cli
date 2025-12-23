/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../../semantic-colors.js';
import { type SkillDefinition } from '../../types.js';

interface SkillsListProps {
  skills: readonly SkillDefinition[];
  showDescriptions: boolean;
}

export const SkillsList: React.FC<SkillsListProps> = ({
  skills,
  showDescriptions,
}) => {
  const sortedSkills = [...skills].sort((a, b) => {
    if (!!a.disabled !== !!b.disabled) {
      return a.disabled ? 1 : -1;
    }
    return a.name.localeCompare(b.name);
  });

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color={theme.text.primary}>
        Available Agent Skills:
      </Text>
      <Box height={1} />
      {sortedSkills.length > 0 ? (
        sortedSkills.map((skill) => (
          <Box key={skill.name} flexDirection="row">
            <Text color={theme.text.primary}>{'  '}- </Text>
            <Box flexDirection="column">
              <Text
                bold
                color={
                  skill.disabled ? theme.text.secondary : theme.text.accent
                }
                dimColor={skill.disabled}
              >
                {skill.name}
                {skill.disabled ? ' (disabled)' : ''}
              </Text>
              {showDescriptions && skill.description && (
                <Box marginLeft={2}>
                  <Text color={theme.text.secondary} dimColor={skill.disabled}>
                    {skill.description}
                  </Text>
                </Box>
              )}
            </Box>
          </Box>
        ))
      ) : (
        <Text color={theme.text.primary}> No skills available</Text>
      )}
    </Box>
  );
};
