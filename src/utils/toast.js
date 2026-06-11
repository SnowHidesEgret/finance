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

  getIconSvg(iconName) {
    switch (iconName) {
      case 'CheckCircle':
        return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check-circle"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`;
      case 'XCircle':
        return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x-circle"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`;
      case 'AlertTriangle':
        return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-alert-triangle"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
      case 'X':
        return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
      case 'Info':
      default:
        return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-info"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
    }
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
