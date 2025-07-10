// Convert Quill Delta format to Markdown
function quillDeltaToMarkdown(delta) {
  if (!delta || !delta.ops) {
    return '';
  }

  let markdown = '';
  let currentLine = '';
  let listLevel = 0;
  let inCodeBlock = false;

  delta.ops.forEach((op) => {
    if (typeof op.insert === 'string') {
      const text = op.insert;
      const attrs = op.attributes || {};

      // Handle line breaks
      const lines = text.split('\n');
      
      for (let i = 0; i < lines.length; i++) {
        if (i > 0) {
          // Process the completed line before the newline
          if (currentLine || Object.keys(attrs).length > 0) {
            markdown += processLine(currentLine, attrs, listLevel);
          } else {
            markdown += '\n';
          }
          currentLine = '';
        }
        
        // Process text formatting
        let formattedText = lines[i];
        
        // Apply inline formatting
        if (attrs.bold) {
          formattedText = `**${formattedText}**`;
        }
        if (attrs.italic) {
          formattedText = `*${formattedText}*`;
        }
        if (attrs.underline) {
          formattedText = `<u>${formattedText}</u>`;
        }
        if (attrs.code) {
          formattedText = `\`${formattedText}\``;
        }
        if (attrs.link) {
          formattedText = `[${formattedText}](${attrs.link})`;
        }
        
        currentLine += formattedText;
      }
    }
  });

  // Process any remaining line
  if (currentLine) {
    markdown += processLine(currentLine, {});
  }

  return markdown.trim();
}

function processLine(text, attrs, listLevel = 0) {
  let line = text;
  
  // Handle block formats
  if (attrs.list) {
    const indent = '  '.repeat(listLevel);
    if (attrs.list === 'ordered') {
      line = `${indent}1. ${line}`;
    } else {
      line = `${indent}- ${line}`;
    }
  } else if (attrs.blockquote) {
    line = `> ${line}`;
  } else if (attrs['code-block']) {
    line = '```\n' + line + '\n```';
  } else if (attrs.indent) {
    const indentLevel = parseInt(attrs.indent) || 0;
    line = '  '.repeat(indentLevel) + line;
  }
  
  return line + '\n';
}

// Format meeting metadata as Markdown front matter
function formatMeetingMetadata(meeting) {
  const metadata = [];
  
  metadata.push('---');
  metadata.push(`title: "${meeting.title}"`);
  metadata.push(`date: ${new Date(meeting.start_time).toISOString().split('T')[0]}`);
  metadata.push(`start_time: ${new Date(meeting.start_time).toLocaleString()}`);
  metadata.push(`end_time: ${new Date(meeting.end_time).toLocaleString()}`);
  
  if (meeting.participants) {
    try {
      const participants = JSON.parse(meeting.participants);
      if (participants && participants.length > 0) {
        metadata.push('participants:');
        participants.forEach(p => {
          metadata.push(`  - ${p}`);
        });
      }
    } catch (e) {
      console.warn('Failed to parse participants:', e);
    }
  }
  
  metadata.push('---');
  metadata.push('');
  
  return metadata.join('\n');
}

// Generate full Markdown document
function generateMarkdownDocument(meeting) {
  let document = '';
  
  // Add metadata
  document += formatMeetingMetadata(meeting);
  
  // Add title
  document += `# ${meeting.title}\n\n`;
  
  // Add meeting time info
  const startTime = new Date(meeting.start_time);
  const endTime = new Date(meeting.end_time);
  const duration = Math.round((endTime - startTime) / 1000 / 60);
  document += `**Meeting Duration:** ${duration} minutes\n\n`;
  
  // Add participants section
  if (meeting.participants) {
    try {
      const participants = JSON.parse(meeting.participants);
      if (participants && participants.length > 0) {
        document += `## Participants\n\n`;
        participants.forEach(p => {
          document += `- ${p}\n`;
        });
        document += '\n';
      }
    } catch (e) {
      console.warn('Failed to parse participants:', e);
    }
  }
  
  // Add notes section
  document += `## Meeting Notes\n\n`;
  
  if (meeting.notes_content) {
    try {
      const notesContent = JSON.parse(meeting.notes_content);
      const markdown = quillDeltaToMarkdown(notesContent);
      document += markdown || '*No notes recorded*';
    } catch (e) {
      // If parsing fails, assume it's plain text
      document += meeting.notes_content || '*No notes recorded*';
    }
  } else {
    document += '*No notes recorded*';
  }
  
  return document;
}

module.exports = {
  quillDeltaToMarkdown,
  formatMeetingMetadata,
  generateMarkdownDocument
};