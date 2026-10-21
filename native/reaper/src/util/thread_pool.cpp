/**
 * ResolveLink REAPER Extension - Thread Pool Implementation
 */

#include "thread_pool.h"

namespace resolvelink {

ThreadPool::ThreadPool(size_t num_threads) {
    if (num_threads == 0) num_threads = 1;
    
    for (size_t i = 0; i < num_threads; ++i) {
        m_workers.emplace_back([this] {
            while (true) {
                std::function<void()> task;
                
                {
                    std::unique_lock<std::mutex> lock(this->m_queue_mutex);
                    this->m_condition.wait(lock, [this] {
                        return this->m_stop || !this->m_tasks.empty();
                    });
                    
                    if (this->m_stop && this->m_tasks.empty()) return;
                    
                    task = std::move(this->m_tasks.front());
                    this->m_tasks.pop();
                    this->m_active_tasks++;
                }
                
                task();
                this->m_active_tasks--;
            }
        });
    }
}

ThreadPool::~ThreadPool() {
    shutdown();
}

size_t ThreadPool::size() const {
    return m_workers.size();
}

size_t ThreadPool::pending() const {
    std::lock_guard<std::mutex> lock(m_queue_mutex);
    return m_tasks.size();
}

void ThreadPool::shutdown() {
    {
        std::lock_guard<std::mutex> lock(m_queue_mutex);
        m_stop = true;
    }
    m_condition.notify_all();
    
    for (std::thread& worker : m_workers) {
        if (worker.joinable()) worker.join();
    }
}

bool ThreadPool::is_shutdown() const {
    return m_stop.load();
}

} // namespace resolvelink