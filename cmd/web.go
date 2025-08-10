package cmd

import (
	"path/filepath"

	"github.com/spf13/cobra"
	"github.com/spf13/viper"
	"go.uber.org/zap"

	"github.com/iyear/tdl/core/logctx"
	"github.com/iyear/tdl/core/util/logutil"
	"github.com/iyear/tdl/pkg/consts"
	"github.com/iyear/tdl/pkg/kv"
	"github.com/iyear/tdl/web/backend"
)

func NewWeb() *cobra.Command {
	var port int

	cmd := &cobra.Command{
		Use:     "web",
		Short:   "Start web interface",
		GroupID: groupTools.ID,
		RunE: func(cmd *cobra.Command, args []string) error {
			// 为web进程创建独立的日志文件，避免与CLI冲突
			level := zap.InfoLevel
			if viper.GetBool("debug") {
				level = zap.DebugLevel
			}
			webLogger := logutil.New(level, filepath.Join(consts.LogPath, "web.log"))
			ctx := logctx.With(cmd.Context(), webLogger)

			// 创建默认的Bolt存储配置
			webBoltStorage := map[string]string{
				kv.DriverTypeKey: kv.DriverBolt.String(),
				"path":           filepath.Join(consts.DataDir, "web_data"),
			}

			// 创建KV存储实例
			kvStore, err := kv.NewWithMap(webBoltStorage)
			if err != nil {
				return err
			}
			// 注意：不在这里关闭存储，因为服务器需要持续使用

			config := backend.Config{
				Port:  port,
				Debug: viper.GetBool("debug"),
			}

			server := backend.NewServer(ctx, kvStore, config)
			return server.Start()
		},
	}

	cmd.Flags().IntVarP(&port, "port", "p", 8080, "web server port")

	return cmd
}