'use strict';

function noColor() {
  return !process.stdout.isTTY || process.env.NO_COLOR != null;
}

function ansi(code) {
  return s => noColor() ? s : `\x1b[${code}m${s}\x1b[0m`;
}

const c = {
  bold:    ansi('1'),
  dim:     ansi('2'),
  red:     ansi('31'),
  green:   ansi('32'),
  yellow:  ansi('33'),
  blue:    ansi('34'),
  magenta: ansi('35'),
  cyan:    ansi('36'),
  gray:    ansi('90'),
};

const BANNER_ICONS = {
  warnings:  '⚠  ',
  decisions: '🏛  ',
  rules:     '📋 ',
  testing:   '🧪 ',
  env:       '⚙  ',
  packages:  '📦 ',
  notes:     '📝 ',
  refs:      '🔗 ',
  tasks:     '✅ ',
  blockers:  '🚫 ',
};

function bannerIcon(name) {
  return BANNER_ICONS[name] || '•  ';
}

function truncate(s, len) {
  len = len || 70;
  if (!s) return '';
  const first = s.split('\n')[0];
  return first.length > len ? first.slice(0, len - 1) + '…' : first;
}

module.exports = { c, bannerIcon, truncate };
