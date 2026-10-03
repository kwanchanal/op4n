(function () {
  const terminalBody = document.getElementById('terminalBody');
  const terminalOutput = terminalBody.querySelector('.terminal-output');

  const commands = {
    'ls -la': 'total 24\ndrwxr-xr-x  6 user staff  192 Apr 19 10:30 .\ndrwxr-xr-x  3 user staff   96 Apr 19 10:25 ..\n-rw-r--r--  1 user staff 1024 Apr 19 10:30 index.html\n-rw-r--r--  1 user staff 2048 Apr 19 10:28 styles.css',
    'pwd': '/Users/user/projects/op4n-me',
    'whoami': 'developer',
    'date': new Date().toString(),
    'help': 'Available commands: ls -la, pwd, whoami, date, clear, help',
    'clear': ''
  };

  let currentCommand = '';
  let history = [];
  let historyIndex = 0;

  function createLine(text, type) {
    const line = document.createElement('div');
    line.className = 'terminal-line';
    if (type === 'prompt') {
      line.innerHTML = `<span class="terminal-prompt">user@op4n:~</span><span class="terminal-command">${text}</span>`;
    } else if (type === 'cursor') {
      line.innerHTML = `<span class="terminal-prompt">user@op4n:~</span><span class="terminal-cursor">${text}</span>`;
    } else {
      line.innerHTML = `<span class="terminal-output-text">${text}</span>`;
    }
    return line;
  }

  function scrollToBottom() {
    terminalBody.scrollTop = terminalBody.scrollHeight;
  }

  function updateCursor() {
    const existing = terminalOutput.querySelector('.terminal-cursor');
    if (existing) existing.parentElement.remove();
    terminalOutput.appendChild(createLine(currentCommand || '_', 'cursor'));
    scrollToBottom();
  }

  function runCommand(input) {
    const trimmed = input.trim();
    const existingCursor = terminalOutput.querySelector('.terminal-cursor');
    if (existingCursor) existingCursor.parentElement.remove();
    terminalOutput.appendChild(createLine(trimmed, 'prompt'));

    if (trimmed === 'clear') {
      terminalOutput.innerHTML = '';
    } else if (commands[trimmed]) {
      const result = commands[trimmed];
      if (result) {
        result.split('\n').forEach((line) => {
          terminalOutput.appendChild(createLine(line));
        });
      }
    } else if (trimmed) {
      terminalOutput.appendChild(createLine(`Command not found: ${trimmed}. Type 'help'`, 'output'));
    }

    history.push(trimmed);
    historyIndex = history.length;
    currentCommand = '';
    updateCursor();
  }

  terminalBody.addEventListener('keydown', (event) => {
    event.preventDefault();
    if (event.key === 'Enter') {
      runCommand(currentCommand);
      return;
    }
    if (event.key === 'Backspace') {
      currentCommand = currentCommand.slice(0, -1);
      updateCursor();
      return;
    }
    if (event.key === 'ArrowUp') {
      if (historyIndex > 0) historyIndex -= 1;
      currentCommand = history[historyIndex] || '';
      updateCursor();
      return;
    }
    if (event.key === 'ArrowDown') {
      historyIndex = Math.min(history.length, historyIndex + 1);
      currentCommand = history[historyIndex] || '';
      updateCursor();
      return;
    }
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
      currentCommand += event.key;
      updateCursor();
    }
  });

  terminalBody.addEventListener('click', () => terminalBody.focus());
  terminalBody.focus();
  updateCursor();
})();