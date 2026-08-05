import { useCallback, useEffect, useState } from 'react'
import { Link, Route, Routes } from 'react-router-dom'
import { Button, Layout, List, Space, Typography, Message } from '@arco-design/web-react'
import ipcBridge from '@/common/adapter/ipcBridge'
import type { TTeam } from '@/common/types/team/teamTypes'
import TeamIndex from '@/pages/team'

function TeamListPage() {
  const [teams, setTeams] = useState<TTeam[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await ipcBridge.team.list.invoke()
      setTeams(Array.isArray(data) ? data : [])
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      Message.error(`加载团队失败: ${msg}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <Layout style={{ minHeight: '100vh', padding: 24 }}>
      <Space direction="vertical" size="medium" style={{ width: '100%' }}>
        <Typography.Title heading={4} style={{ margin: 0 }}>
          Team-Lite
        </Typography.Title>
        <Typography.Text type="secondary">
          后端默认 <code>127.0.0.1:3000</code>，Vite 代理 <code>/api</code> 与 <code>/ws</code>
          （见 docs/local-dev.md）。
        </Typography.Text>
        <Space>
          <Button type="primary" loading={loading} onClick={() => void refresh()}>
            刷新团队列表
          </Button>
        </Space>
        {error ? <Typography.Text type="error">{error}</Typography.Text> : null}
        <List
          header="Teams"
          bordered
          dataSource={teams}
          noDataElement={loading ? '加载中…' : '暂无团队（用 POST /api/teams 创建）'}
          render={(item) => (
            <List.Item key={item.id}>
              <Space direction="vertical" size={2}>
                <Typography.Text bold>
                  <Link to={`/team/${item.id}`}>{item.name}</Link>{' '}
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {item.id}
                  </Typography.Text>
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  members: {item.assistants?.length ?? 0}
                  {item.workspace ? ` · ${item.workspace}` : ''}
                </Typography.Text>
              </Space>
            </List.Item>
          )}
        />
      </Space>
    </Layout>
  )
}

/**
 * Routes: list shell + full TeamPage (E3–E5, still stub-heavy).
 */
function App() {
  return (
    <Routes>
      <Route path="/" element={<TeamListPage />} />
      <Route path="/team/:id" element={<TeamIndex />} />
    </Routes>
  )
}

export default App
