import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TuiRoot } from '@taiga-ui/core';
import { BrandService } from './core/services/ui.services';
import { ThemeService } from './core/services/theme.service';
import { ConfirmHost, ToastHost } from './shared/components/feedback-hosts';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, TuiRoot, ToastHost, ConfirmHost],
  template: `<tui-root><router-outlet /><app-toast-host /><app-confirm-host /></tui-root>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  // Instanciar activa la marca dinámica (§19.2).
  private readonly brand = inject(BrandService);
  private readonly theme = inject(ThemeService);
}
