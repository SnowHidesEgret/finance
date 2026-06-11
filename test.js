import { icons } from 'lucide';
const iconNames = ['CheckCircle', 'XCircle', 'AlertTriangle', 'Info', 'X'];
for (const iconName of iconNames) {
  const icon = icons[iconName];
  if (!icon) {
    console.log(`Icon ${iconName} is MISSING!`);
  } else {
    try {
      console.log(`Icon ${iconName}:`, icon.map(node => `<${node[0]} ${Object.entries(node[1]).map(([k, v]) => `${k}="${v}"`).join(' ')}></${node[0]}>`).join(''));
    } catch (e) {
      console.log(`Icon ${iconName} error:`, e.message);
    }
  }
}
