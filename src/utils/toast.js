import { icons } from 'lucide';

/**
 * Toast Notification System
 * Handles creation and dismissal of global toast notifications.
 */

class ToastManager {
  constructor() {
    this.container = null;
    this.history = []; // store history
    this.unreadCount = 0;
    this.maxHistory = 50;
    this.initContainer();
  }

  initContainer() {
    if (typeof document === 'undefined') return;
    
    this.container = document.getElementById('toast-container');
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = 'toast-container';
      this.container.className = 'toast-container';
      document.body.appendChild(this.container);
    }
  }

  /**
   * Helper to get SVG string from lucide icons
   */
  getIconSvg(iconName) {
    const icon = icons[iconName];
    if (icon) {
      // Create SVG string with specific classes if needed
      return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-${iconName}">${icon[1].map(node => `<${node[0]} ${Object.entries(node[1]).map(([k, v]) => `${k}="${v}"`).join(' ')}></${node[0]}>`).join('')}</svg>`;
    }
    return '';
  }

  /**
   * Dispatch a custom event to notify listeners (e.g. Header.js) that history changed
   */
  dispatchChange() {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('toast:change', {
        detail: {
          history: this.history,
          unreadCount: this.unreadCount
        }
      }));
    }
  }

  /**
   * Show a toast notification
   */
  show({ title, message, type = 'info', duration = 4000 }) {
    this.initContainer();
    
    let iconName = 'info';
    let titleText = title || '提示';
    
    switch (type) {
      case 'success':
        iconName = 'CheckCircle';
        titleText = title || '成功';
        break;
      case 'error':
        iconName = 'XCircle';
        titleText = title || '错误';
        break;
      case 'warning':
        iconName = 'AlertTriangle';
        titleText = title || '警告';
        break;
      case 'info':
      default:
        iconName = 'Info';
        break;
    }

    // Add to history
    const id = Date.now().toString() + Math.random().toString(36).substring(2, 9);
    this.history.unshift({
      id,
      title: titleText,
      message,
      type,
      iconName,
      timestamp: Date.now()
    });
    
    // Keep max history
    if (this.history.length > this.maxHistory) {
      this.history.pop();
    }
    this.unreadCount++;
    this.dispatchChange();
    
    // Render Toast DOM
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;

    const iconSvg = this.getIconSvg(iconName);

    toast.innerHTML = `
      <div class="toast__icon">
        ${iconSvg}
      </div>
      <div class="toast__content">
        <h4 class="toast__title">${titleText}</h4>
        ${message ? `<p class="toast__message">${message}</p>` : ''}
      </div>
      <button class="toast__close" aria-label="Close">
        ${this.getIconSvg('X')}
      </button>
      <div class="toast__progress" style="animation: toast-progress ${duration}ms linear forwards;"></div>
    `;

    this.container.appendChild(toast);

    const closeBtn = toast.querySelector('.toast__close');
    
    let timeoutId;
    
    const removeToast = () => {
      toast.classList.add('toast--closing');
      toast.addEventListener('animationend', (e) => {
        if (e.animationName === 'toast-slide-out') {
          if (toast.parentNode) {
            toast.parentNode.removeChild(toast);
          }
        }
      });
    };

    closeBtn.addEventListener('click', () => {
      clearTimeout(timeoutId);
      removeToast();
    });

    if (duration > 0) {
      timeoutId = setTimeout(removeToast, duration);
      
      // Pause on hover
      toast.addEventListener('mouseenter', () => {
        clearTimeout(timeoutId);
        const progress = toast.querySelector('.toast__progress');
        if(progress) progress.style.animationPlayState = 'paused';
      });
      
      toast.addEventListener('mouseleave', () => {
        timeoutId = setTimeout(removeToast, duration);
        const progress = toast.querySelector('.toast__progress');
        if(progress) progress.style.animationPlayState = 'running';
      });
    }
  }

  success(message, title) {
    this.show({ message, title, type: 'success' });
  }

  error(message, title) {
    this.show({ message, title, type: 'error', duration: 5000 });
  }

  warning(message, title) {
    this.show({ message, title, type: 'warning' });
  }

  info(message, title) {
    this.show({ message, title, type: 'info' });
  }

  markAllAsRead() {
    this.unreadCount = 0;
    this.dispatchChange();
  }

  clearHistory() {
    this.history = [];
    this.unreadCount = 0;
    this.dispatchChange();
  }

  getHistory() {
    return this.history;
  }
}

// Export a singleton instance
export const Toast = new ToastManager();

// Also attach to window for easy access from non-module scripts or legacy code if needed
if (typeof window !== 'undefined') {
  window.Toast = Toast;
}
