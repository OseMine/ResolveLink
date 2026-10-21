/**
 * ResolveLink REAPER Extension - Thread Pool
 * 
 * Simple thread pool for background tasks (HTTP, file I/O, render monitoring).
 */

#pragma once

#include <vector>
#include <queue>
#include <thread>
#include <mutex>
#include <condition_variable>
#include <functional>
#include <future>
#include <atomic>
#include <memory>

namespace resolvelink {

class ThreadPool {
public:
    explicit ThreadPool(size_t num_threads = std::thread::hardware_concurrency());
    ~ThreadPool();
    
    // Enqueue a task
    template<typename F, typename... Args>
    auto enqueue(F&& f, Args&&... args) 
        -> std::future<typename std::invoke_result<F, Args...>::type>;
    
    // Get number of worker threads
    size_t size() const;
    
    // Get number of pending tasks
    size_t pending() const;
    
    // Shutdown and wait for all tasks
    void shutdown();
    
    // Check if shutdown
    bool is_shutdown() const;

private:
    std::vector<std::thread> m_workers;
    std::queue<std::function<void()>> m_tasks;
    std::mutex m_queue_mutex;
    std::condition_variable m_condition;
    std::atomic<bool> m_stop{false};
    std::atomic<size_t> m_active_tasks{0};
};

// Implementation
template<typename F, typename... Args>
auto ThreadPool::enqueue(F&& f, Args&&... args) 
    -> std::future<typename std::invoke_result<F, Args...>::type> {
    
    using return_type = typename std::invoke_result<F, Args...>::type;
    
    auto task = std::make_shared<std::packaged_task<return_type()>>(
        std::bind(std::forward<F>(f), std::forward<Args>(args)...)
    );
    
    std::future<return_type> res = task->get_future();
    
    {
        std::lock_guard<std::mutex> lock(m_queue_mutex);
        if (m_stop) {
            throw std::runtime_error("ThreadPool is stopped");
        }
        m_tasks.emplace([task]() { (*task)(); });
    }
    
    m_condition.notify_one();
    return res;
}

} // namespace resolvelink