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

  build() {
    Column({ space: 10 }) {
      Row({ space: 8 }) {
        Text('2')
          .width(24)
          .height(24)
          .textAlign(TextAlign.Center)
          .fontSize(13)
          .fontWeight(FontWeight.Bold)
          .fontColor('#FFFFFF')
          .backgroundColor('#0F8A5F')
          .borderRadius(12)
        Text('接收电脑结果')
          .fontSize(17)
          .fontWeight(FontWeight.Medium)
          .fontColor('#162033')
      }
      .width('100%')
      Text('电脑上处理完成后，先刷新，再下载改好日期的文件，最后用系统按钮保存到图库。')
        .fontSize(12)
        .fontColor('#667085')
      Row({ space: 10 }) {
        Button(this.refreshing ? '刷新中…' : '刷新结果')
          .onClick(() => {
            this.onRefresh();
          })
          .enabled(!this.refreshing)
          .layoutWeight(1)
        Button(this.downloading ? `下载中 ${this.downloadProgress}%` : `下载全部结果 (${this.outboxFiles.length})`)
          .onClick(() => {
            this.onDownload();
          })
          .enabled(!this.downloading && this.outboxFiles.length > 0)
          .layoutWeight(1)
      }
      .width('100%')
      if (this.downloadedCount > 0) {
        Column({ space: 8 }) {
          Text(`已下载 ${this.downloadedCount} 个，等待保存到图库`)
            .fontSize(13)
            .fontColor('#0F8A5F')
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
      }
      if (this.outboxRun) {
        Text(`批次 ${this.outboxRun}`)
          .fontSize(11)
          .fontColor('#98A2B3')
      }
      if (this.outboxFiles.length > 0) {
        Column({ space: 6 }) {
          Text(`电脑上有 ${this.outboxFiles.length} 个结果`)
            .fontSize(13)
            .fontWeight(FontWeight.Medium)
            .fontColor('#344054')
          ForEach(this.visibleFiles(), (item: OutboxFile) => {
            Row({ space: 8 }) {
              Text(item.kind === 'video' ? '视频' : '图片')
                .fontSize(10)
                .fontColor('#2F6FED')
                .backgroundColor('#EAF2FF')
                .padding({ left: 6, right: 6, top: 2, bottom: 2 })
                .borderRadius(4)
              Column({ space: 2 }) {
                Text(item.name)
                  .fontSize(12)
                  .fontColor('#344054')
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                Text(`${this.formatBytes(item.size)} · ${item.date}`)
                  .fontSize(10)
                  .fontColor('#98A2B3')
              }
              .layoutWeight(1)
              .alignItems(HorizontalAlign.Start)
            }
            .width('100%')
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
        .backgroundColor('#F7F9FC')
        .borderRadius(10)
        .alignItems(HorizontalAlign.Start)
      }
    }
    .width('100%')
    .padding(16)
    .backgroundColor('#FFFFFF')
    .borderRadius(14)
    .alignItems(HorizontalAlign.Start)
  }
}
