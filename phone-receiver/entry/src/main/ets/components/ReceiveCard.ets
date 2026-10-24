import { curves } from '@kit.ArkUI';
import { BusinessError } from '@kit.BasicServicesKit';
import { OutboxFile } from '../model/Types';

@Component
export struct ReceiveCard {
  @Prop refreshing: boolean = false;
  @Prop downloading: boolean = false;
  @Prop downloadProgress: number = 0;
  @Prop outboxRun: string = '';
  @Prop outboxFiles: OutboxFile[] = [];
  @Prop outboxExpanded: boolean = false;
  @Prop downloadedCount: number = 0;
  @Prop baseUrl: string = '';
  @Prop token: string = '';
  onRefresh: () => void = () => {};
  onDownload: () => void = () => {};
  onToggleExpand: () => void = () => {};
  onSave: SaveButtonCallback = async (
    event: ClickEvent,
    result: SaveButtonOnClickResult,
    error?: BusinessError
  ) => {};

  private formatBytes(value: number): string {
    if (!Number.isFinite(value) || value <= 0) {
      return '0 B';
    }
    if (value >= 1024 * 1024 * 1024) {
      return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
    }
    if (value >= 1024 * 1024) {
      return `${(value / 1024 / 1024).toFixed(1)} MB`;
    }
    if (value >= 1024) {
      return `${Math.round(value / 1024)} KB`;
    }
    return `${Math.round(value)} B`;
  }

  private visibleFiles(): OutboxFile[] {
    return this.outboxExpanded ? this.outboxFiles : this.outboxFiles.slice(0, 5);
  }

  private previewUrl(item: OutboxFile): string {
    return `${this.baseUrl}/api/outbox/file?run=${encodeURIComponent(this.outboxRun)}&path=${encodeURIComponent(item.relativePath)}&token=${encodeURIComponent(this.token)}`;
  }

  build() {
    Column({ space: 10 }) {
      Row({ space: 8 }) {
        Text('2')
          .width(24)
          .height(24)
          .textAlign(TextAlign.Center)
          .fontSize(13)
          .fontWeight(FontWeight.Bold)
          .fontColor($r('app.color.on_accent'))
          .backgroundColor($r('app.color.success'))
          .borderRadius(12)
        Text('接收电脑结果')
          .fontSize(17)
          .fontWeight(FontWeight.Medium)
          .fontColor($r('app.color.text_primary'))
      }
      .width('100%')
      Text('电脑上处理完成后，先刷新，再下载改好日期的文件，最后用系统按钮保存到图库。')
        .fontSize(12)
        .fontColor($r('app.color.text_muted'))
      Row({ space: 10 }) {
        Button(this.refreshing ? '刷新中…' : '刷新结果')
          .onClick(() => {
            this.onRefresh();
          })
          .enabled(!this.refreshing)
          .height(44)
          .layoutWeight(1)
        Button(this.downloading ? `下载中 ${this.downloadProgress}%` : `下载全部结果 (${this.outboxFiles.length})`)
          .onClick(() => {
            this.onDownload();
          })
          .enabled(!this.downloading && this.outboxFiles.length > 0)
          .height(44)
          .layoutWeight(1)
      }
      .width('100%')
      if (this.downloadedCount > 0) {
        Column({ space: 8 }) {
          Text(`已下载 ${this.downloadedCount} 个，等待保存到图库`)
            .fontSize(13)
            .fontColor($r('app.color.success'))
          SaveButton({
            icon: SaveIconStyle.FULL_FILLED,
            text: SaveDescription.SAVE,
            buttonType: ButtonType.Capsule
          })
            .onClick(this.onSave)
            .width('100%')
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
        .transition(TransitionEffect.OPACITY.animation({ duration: 300, curve: curves.springMotion(0.3, 0.76) }))
      }
      if (this.outboxRun) {
        Text(`批次 ${this.outboxRun}`)
          .fontSize(11)
          .fontColor($r('app.color.text_faint'))
      }
      if (this.outboxFiles.length > 0) {
        Column({ space: 6 }) {
          Text(`电脑上有 ${this.outboxFiles.length} 个结果`)
            .fontSize(13)
            .fontWeight(FontWeight.Medium)
            .fontColor($r('app.color.text_secondary'))
          ForEach(this.visibleFiles(), (item: OutboxFile) => {
            Row({ space: 10 }) {
              if (item.kind === 'image') {
                Image(this.previewUrl(item))
                  .width(44)
                  .height(44)
                  .borderRadius(9)
                  .objectFit(ImageFit.Cover)
                  .backgroundColor($r('app.color.surface_soft'))
              } else {
                Column() {
                  Text('视频')
                    .fontSize(10)
                    .fontColor($r('app.color.accent'))
                }
                .width(44)
                .height(44)
                .borderRadius(9)
                .backgroundColor($r('app.color.accent_soft'))
                .justifyContent(FlexAlign.Center)
              }
              Column({ space: 3 }) {
                Text(item.name)
                  .fontSize(12)
                  .fontColor($r('app.color.text_secondary'))
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                Text(`${item.kind === 'video' ? '视频' : '图片'} · ${this.formatBytes(item.size)} · ${item.date}`)
                  .fontSize(10)
                  .fontColor($r('app.color.text_faint'))
              }
              .layoutWeight(1)
              .alignItems(HorizontalAlign.Start)
            }
            .width('100%')
            .padding({ top: 2, bottom: 2 })
          }, (item: OutboxFile) => item.relativePath)
          if (this.outboxFiles.length > 5) {
            Button(this.outboxExpanded ? '收起列表' : `展开全部 ${this.outboxFiles.length} 个`)
              .fontSize(12)
              .width('100%')
              .onClick(() => {
                this.onToggleExpand();
              })
          }
        }
        .width('100%')
        .padding(10)
        .backgroundColor($r('app.color.surface_soft'))
        .borderRadius(10)
        .alignItems(HorizontalAlign.Start)
      }
    }
    .width('100%')
    .padding(16)
    .backgroundColor($r('app.color.surface'))
    .borderRadius(14)
    .shadow({ radius: 18, color: $r('app.color.shadow'), offsetY: 5 })
    .alignItems(HorizontalAlign.Start)
  }
}
